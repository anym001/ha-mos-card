import { LitElement, html, nothing, TemplateResult, css, CSSResultGroup, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HassEntity } from 'home-assistant-js-websocket';
import type { UnsubscribeFunc } from 'home-assistant-js-websocket';
import {
  HomeAssistant,
  hasAction,
  ActionConfig,
  ActionHandlerEvent,
  handleAction,
  LovelaceCardEditor,
  computeStateDisplay,
} from 'custom-card-helpers';

import type { LovelaceGridOptions, MosCardConfig } from './types';
import {
  DeviceRegistryEntry,
  EntityRegistryEntry,
  IntegrationIcons,
  KIND_INFO,
  MOS_DEVICE_KINDS,
  MosDeviceKind,
  ROW_SORTS,
  SECONDARY_INFO_MODES,
  SERVER_METRICS,
  declaredIcon,
  deviceDisplayName,
  entitiesByDevice,
  fetchIntegrationIcons,
  findMetricEntity,
  findPowerEntity,
  findProblemCandidates,
  findServerDevices,
  findStateEntity,
  findUpdateEntity,
  isMosDeviceKind,
  isUnavailableState,
  metricsForMode,
  passesFilter,
  selectMosDevices,
  subscribeDeviceRegistry,
  subscribeEntityRegistry,
} from './devices';
import { actionHandler } from './action-handler-directive';
import { CARD_VERSION } from './const';
import { localize } from './localize/localize';

console.info(
  `%c  MOS-CARD \n%c  ${localize('common.version')} ${CARD_VERSION}    `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

interface WindowWithCustomCards extends Window {
  customCards: Array<{ type: string; name: string; description: string }>;
}

(window as unknown as WindowWithCustomCards).customCards =
  (window as unknown as WindowWithCustomCards).customCards || [];
(window as unknown as WindowWithCustomCards).customCards.push({
  type: 'mos-card',
  name: 'MOS NAS Card',
  description: 'Containers, VMs, disks, pools and the UPS of a MOS NAS server',
});

/**
 * How long a power button stays in its waiting state before giving up on it.
 *
 * The switch normally settles well inside this: the integration flips its own
 * state optimistically as soon as the MOS call returns. The timeout is only
 * there so a request that never comes back leaves a usable button behind
 * rather than a permanently spinning one.
 */
const PENDING_TIMEOUT_MS = 20000;

/** One rendered line: a device plus the entities the row is built from. */
interface DeviceRow {
  device: DeviceRegistryEntry;
  kind: MosDeviceKind;
  name: string;
  stateEntity?: EntityRegistryEntry;
  powerEntity?: EntityRegistryEntry;
  updateEntity?: EntityRegistryEntry;
  /** The measurements to show beside the state, in the order they are shown. */
  metricEntities: EntityRegistryEntry[];
  /** Binary sensors that could carry a fault; which do is read off the state. */
  problemCandidates: EntityRegistryEntry[];
}

/** Rows of one kind, under one server. */
interface RowGroup {
  kind: MosDeviceKind;
  rows: DeviceRow[];
  /** How many rows the cap is hiding; zero when nothing is hidden. */
  hidden: number;
  /** Identifies the group across renders, so an opened one stays open. */
  key: string;
}

/** Everything belonging to one MOS server. */
interface ServerSection {
  server?: DeviceRegistryEntry;
  groups: RowGroup[];
  /** What the server reports about itself, when the config asks for it. */
  serverMetrics: EntityRegistryEntry[];
}

@customElement('mos-card')
export class MosCard extends LitElement {
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./editor');
    return document.createElement('mos-card-editor');
  }

  public static getStubConfig(): Record<string, unknown> {
    return { kinds: [...MOS_DEVICE_KINDS] };
  }

  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private config!: MosCardConfig;

  /**
   * The registries, mirrored locally.
   *
   * These are the card's source of truth for *which* devices exist; `hass`
   * remains the source of truth for what state each one is in. Keeping them
   * apart is what makes the card follow container churn: the registry
   * subscriptions fire when the integration adds or removes a device, and
   * ordinary `hass` updates handle everything else.
   */
  @state() private devices?: DeviceRegistryEntry[];

  @state() private entities?: EntityRegistryEntry[];

  /**
   * The icons the integration declares for its entities.
   *
   * Fetched rather than read off the state, because `icons.json` icons are
   * resolved in the frontend and never reach a state attribute.
   */
  @state() private icons?: IntegrationIcons;

  /**
   * Power switches with a request in flight, each mapped to the state it had
   * when the button was pressed.
   *
   * Starting or stopping a guest is not instant — MOS has to do it and the
   * integration has to hear back — and without a mark the row looks like the
   * click did nothing, so people press again. The recorded state is what tells
   * the card the request landed: when the switch reports something else, the
   * wait is over. Replaced rather than mutated, so Lit sees the change.
   */
  @state() private pending: ReadonlyMap<string, string> = new Map();

  /**
   * Groups the reader has opened past `max_rows`.
   *
   * Kept per group rather than per card, so opening the containers does not
   * also unfold the disks. Replaced rather than mutated, so Lit sees it.
   */
  @state() private expanded: ReadonlySet<string> = new Set();

  private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private unsubscribe: UnsubscribeFunc[] = [];

  private trackedCache?: {
    devices?: DeviceRegistryEntry[];
    entities?: EntityRegistryEntry[];
    config: MosCardConfig;
    ids: string[];
  };

  public setConfig(config: MosCardConfig): void {
    if (!config) {
      throw new Error(localize('common.invalid_configuration'));
    }

    if (config.kinds !== undefined) {
      if (!Array.isArray(config.kinds)) {
        throw new Error(localize('errors.kinds_not_a_list'));
      }
      const unknown = config.kinds.filter((kind) => !isMosDeviceKind(kind));
      if (unknown.length) {
        throw new Error(`${localize('errors.unknown_kind')}: ${unknown.join(', ')}`);
      }
      if (!config.kinds.length) {
        throw new Error(localize('errors.no_kinds'));
      }
    }

    if (config.sort !== undefined && !ROW_SORTS.includes(config.sort)) {
      throw new Error(`${localize('errors.unknown_sort')}: ${config.sort}`);
    }

    if (config.secondary_info !== undefined && !SECONDARY_INFO_MODES.includes(config.secondary_info)) {
      throw new Error(`${localize('errors.unknown_secondary_info')}: ${config.secondary_info}`);
    }

    if (config.max_rows !== undefined && (!Number.isInteger(config.max_rows) || config.max_rows < 1)) {
      throw new Error(`${localize('errors.bad_max_rows')}: ${config.max_rows}`);
    }

    if (
      config.columns !== undefined &&
      (!Number.isInteger(config.columns) || config.columns < 1 || config.columns > 4)
    ) {
      throw new Error(`${localize('errors.bad_columns')}: ${config.columns}`);
    }

    this.config = {
      kinds: [...MOS_DEVICE_KINDS],
      group_by_kind: true,
      sort: 'name',
      secondary_info: 'none',
      show_server_summary: false,
      show_icon: true,
      show_state: true,
      show_link: true,
      show_power: true,
      confirm_stop: false,
      show_problem: true,
      columns: 1,
      compact: false,
      show_update: true,
      hide_unavailable: false,
      tap_action: { action: 'more-info' },
      ...config,
    };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.subscribeRegistries();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeRegistries();
    this.clearPendingTimers();
  }

  /**
   * Drop any wait that the incoming states have answered.
   *
   * Runs before the render rather than after it, so the button that is about to
   * be drawn is already the settled one and never flickers through a frame of
   * spinner it no longer needs.
   */
  protected willUpdate(changedProps: PropertyValues): void {
    if (!changedProps.has('hass') || !this.pending.size) {
      return;
    }

    for (const [entityId, before] of this.pending) {
      if ((this.hass.states[entityId]?.state ?? '') !== before) {
        this.clearPending(entityId);
      }
    }
  }

  protected updated(changedProps: PropertyValues): void {
    // `hass` arrives after the element is connected on a fresh dashboard load,
    // so the subscription cannot be set up in connectedCallback alone.
    if (changedProps.has('hass') && !this.unsubscribe.length) {
      this.subscribeRegistries();
    }
  }

  /**
   * Re-render only for state changes that can actually show up on this card.
   *
   * `hass` is replaced on every state change anywhere in Home Assistant, which
   * on a busy instance is many times a second. The card is interested in a
   * small, known set of entities — the state sensor and power switch of each
   * device it renders — so everything else is filtered out here.
   */
  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) {
      return false;
    }

    // The registry subscription is established in updated(), which only runs
    // after a render, so the first updates have to be let through unfiltered.
    if (!this.unsubscribe.length) {
      return true;
    }

    if (
      changedProps.has('config') ||
      changedProps.has('devices') ||
      changedProps.has('entities') ||
      changedProps.has('icons') ||
      changedProps.has('pending') ||
      changedProps.has('expanded')
    ) {
      return true;
    }

    if (!changedProps.has('hass')) {
      return false;
    }

    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;

    if (!oldHass) {
      return true;
    }

    return this.trackedEntityIds().some((entityId) => oldHass.states[entityId] !== this.hass.states[entityId]);
  }

  /**
   * The entity ids whose state this card displays.
   *
   * Derived from the registries and the config alone — deliberately *not* from
   * the rendered rows, because `hide_unavailable` drops rows based on state and
   * a hidden row's entity still has to be watched for it to ever come back.
   *
   * Memoized on the identity of its three inputs, all of which are replaced
   * wholesale rather than mutated, so a reference check is enough.
   */
  private trackedEntityIds(): string[] {
    const cache = this.trackedCache;

    if (cache && cache.devices === this.devices && cache.entities === this.entities && cache.config === this.config) {
      return cache.ids;
    }

    const ids: string[] = [];

    if (this.devices && this.entities) {
      const kinds = (this.config.kinds ?? [...MOS_DEVICE_KINDS]) as MosDeviceKind[];
      const entityIndex = entitiesByDevice(this.entities);

      for (const device of selectMosDevices(this.devices, kinds, this.config.server)) {
        const deviceEntities = entityIndex.get(device.id) ?? [];
        const kind = device.model_id as MosDeviceKind;
        const stateEntity = findStateEntity(deviceEntities, kind);
        const powerEntity = findPowerEntity(deviceEntities, kind);

        if (stateEntity) {
          ids.push(stateEntity.entity_id);
        }
        if (powerEntity) {
          ids.push(powerEntity.entity_id);
        }
        for (const metric of this.rowMetricEntities(deviceEntities, kind)) {
          ids.push(metric.entity_id);
        }
        if (this.config.show_problem) {
          for (const candidate of findProblemCandidates(deviceEntities)) {
            ids.push(candidate.entity_id);
          }
        }
      }

      // The server's own entities, which no row is built from and which are
      // therefore not reached by the loop above.
      if (this.config.show_server_summary) {
        for (const server of findServerDevices(this.devices)) {
          for (const metric of SERVER_METRICS) {
            const entity = findMetricEntity(entityIndex.get(server.id) ?? [], metric);

            if (entity) {
              ids.push(entity.entity_id);
            }
          }
        }
      }
    }

    this.trackedCache = { devices: this.devices, entities: this.entities, config: this.config, ids };

    return ids;
  }

  private subscribeRegistries(): void {
    if (this.unsubscribe.length || !this.hass?.connection) {
      return;
    }

    this.unsubscribe = [
      subscribeDeviceRegistry(this.hass.connection, (devices) => {
        this.devices = devices;
      }),
      subscribeEntityRegistry(this.hass.connection, (entities) => {
        this.entities = entities;
      }),
    ];

    // Best effort: without it the card falls back to its own per-kind icons,
    // which is a cosmetic loss and no reason to fail the whole card.
    fetchIntegrationIcons(this.hass.connection, 'mos')
      .then((icons) => {
        this.icons = icons;
      })
      .catch(() => undefined);
  }

  private unsubscribeRegistries(): void {
    for (const unsub of this.unsubscribe) {
      unsub();
    }
    this.unsubscribe = [];
  }

  /**
   * Card height in Lovelace's grid units, so masonry can lay the column out.
   *
   * One unit per row plus one for the card's own chrome, and a floor of 3 while
   * the registry is still loading so the card does not visibly jump once the
   * rows arrive.
   */
  public getCardSize(): number {
    const sections = this.buildSections();
    if (!sections) {
      return 3;
    }

    const rows = sections.reduce(
      (total, section) => total + section.groups.reduce((sum, group) => sum + group.rows.length, 0),
      0,
    );

    return Math.max(3, rows + 1);
  }

  /**
   * The card's footprint in the sections view.
   *
   * `getCardSize` above answers for masonry; the sections layout asks this
   * instead. Full width and content-driven height are what a card that answers
   * nothing already falls back to today, so declaring them changes no existing
   * dashboard — it states the card's shape rather than inheriting it from a
   * frontend default that is free to move.
   *
   * `min_columns` is the part that does something on its own: a row carries an
   * icon, a name, a state and up to two controls, and the frontend honours the
   * floor when a dashboard asks for less, so the card can no longer be squeezed
   * to a width where every name is ellipsis.
   */
  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: 'auto', min_columns: 6 };
  }

  /**
   * Turn the two registries into the sections to render.
   *
   * Returns undefined while the registries are still in flight, which the
   * caller renders as a loading state rather than as "nothing found".
   */
  private buildSections(): ServerSection[] | undefined {
    if (!this.devices || !this.entities || !this.config) {
      return undefined;
    }

    const kinds = (this.config.kinds ?? [...MOS_DEVICE_KINDS]) as MosDeviceKind[];
    const entityIndex = entitiesByDevice(this.entities);

    const servers = this.config.server
      ? this.devices.filter((device) => device.id === this.config.server)
      : findServerDevices(this.devices);

    // A configured server id that no longer resolves still deserves its
    // devices: fall back to filtering by via_device_id alone.
    const serverIds: Array<string | undefined> = servers.length
      ? servers.map((server) => server.id)
      : [this.config.server];

    const sections: ServerSection[] = [];

    for (const serverId of serverIds) {
      const server = servers.find((candidate) => candidate.id === serverId);
      const serverName = server ? server.name_by_user || server.name || undefined : undefined;
      const devices = selectMosDevices(this.devices, kinds, serverId);
      const groups: RowGroup[] = [];

      for (const kind of kinds) {
        const rows = devices
          .filter((device) => device.model_id === kind)
          .map((device) => {
            const deviceEntities = entityIndex.get(device.id) ?? [];
            return {
              device,
              kind,
              name: deviceDisplayName(device, serverName),
              stateEntity: findStateEntity(deviceEntities, kind),
              powerEntity: findPowerEntity(deviceEntities, kind),
              updateEntity: findUpdateEntity(deviceEntities, kind),
              metricEntities: this.rowMetricEntities(deviceEntities, kind),
              problemCandidates: this.config.show_problem ? findProblemCandidates(deviceEntities) : [],
            };
          })
          .filter((row) => passesFilter(row.name, this.config.filter))
          .filter((row) => !this.config.hide_unavailable || !isUnavailableState(this.stateValue(row)))
          .sort((left, right) => this.compareRows(left, right));

        if (rows.length) {
          const key = `${serverId ?? ''}:${kind}`;
          const cap = this.config.max_rows;
          const capped = cap !== undefined && !this.expanded.has(key) && rows.length > cap;

          groups.push({
            kind,
            key,
            rows: capped ? rows.slice(0, cap) : rows,
            hidden: capped ? rows.length - (cap as number) : 0,
          });
        }
      }

      if (groups.length) {
        sections.push({
          server,
          groups,
          serverMetrics:
            this.config.show_server_summary && server
              ? SERVER_METRICS.map((metric) => findMetricEntity(entityIndex.get(server.id) ?? [], metric)).filter(
                  (entity): entity is EntityRegistryEntry => entity !== undefined,
                )
              : [],
        });
      }
    }

    return sections;
  }

  private stateValue(row: DeviceRow): string | undefined {
    return row.stateEntity ? this.hass?.states[row.stateEntity.entity_id]?.state : undefined;
  }

  /** The measurement entities one row shows, in the order they are shown. */
  private rowMetricEntities(entities: readonly EntityRegistryEntry[], kind: MosDeviceKind): EntityRegistryEntry[] {
    const mode = this.config.secondary_info ?? 'none';

    if (mode === 'none') {
      return [];
    }

    return metricsForMode(kind, mode)
      .map((metric) => findMetricEntity(entities, metric))
      .filter((entity): entity is EntityRegistryEntry => entity !== undefined);
  }

  /**
   * How two rows of the same kind are ordered.
   *
   * `state` ranks by the same tone the row is drawn in, so the sorted order and
   * the colours tell the same story, and falls back to the name so that two
   * rows in the same state keep a stable, readable order.
   */
  private compareRows(left: DeviceRow, right: DeviceRow): number {
    if (this.config.sort === 'state') {
      const rank = this.sortRank(left) - this.sortRank(right);

      if (rank !== 0) {
        return rank;
      }
    }

    return left.name.localeCompare(right.name);
  }

  /** Where a row's tone places it under `sort: state`. */
  private sortRank(row: DeviceRow): number {
    const order = ['active', 'idle', 'neutral', 'inactive', 'unknown'];
    const stateObj = row.stateEntity ? this.hass?.states[row.stateEntity.entity_id] : undefined;

    return order.indexOf(this.tone(row.kind, stateObj));
  }

  protected render(): TemplateResult {
    return html`
      <ha-card .header=${this.config.title}>
        <div class="card-content">${this.renderBody()}</div>
      </ha-card>
    `;
  }

  /**
   * The card body: a notice while the registries are still loading, a notice
   * when nothing matched, and the sections themselves otherwise.
   *
   * Written as early returns rather than the nested ternary this used to be.
   * Prettier changed how it indents nested ternaries between 3.8 and 3.9, so
   * that construct turned every Prettier bump into a lint failure on a line
   * whose behaviour never changed. Early returns format identically under both.
   */
  private renderBody(): TemplateResult | TemplateResult[] {
    const sections = this.buildSections();

    if (sections === undefined) {
      return this.renderNotice(localize('common.loading'));
    }

    if (sections.length === 0) {
      return this.renderNotice(localize('common.no_devices'));
    }

    return sections.map((section) => this.renderSection(section, sections.length > 1));
  }

  private renderNotice(message: string): TemplateResult {
    return html`<div class="notice">${message}</div>`;
  }

  private renderSection(section: ServerSection, showServerHeading: boolean): TemplateResult {
    const heading = section.server
      ? section.server.name_by_user || section.server.name || localize('common.server')
      : localize('common.server');
    const summary = this.formatMetrics(section.serverMetrics);

    // The heading is otherwise omitted for a single server, where it only
    // repeats the card's own title — but a summary has to hang off something,
    // so asking for one brings the name back with it.
    return html`
      ${
        showServerHeading || summary
          ? html`
              <div class="server-heading">
                <span>${heading}</span>
                ${summary ? html`<span class="server-summary">${summary}</span>` : nothing}
              </div>
            `
          : nothing
      }
      ${section.groups.map((group) => this.renderGroup(group))}
    `;
  }

  private renderGroup(group: RowGroup): TemplateResult {
    return html`
      ${this.config.group_by_kind ? html`<div class="kind-heading">${localize(`kinds.${group.kind}`)}</div>` : nothing}
      <div class="group cols-${this.config.columns ?? 1}">${group.rows.map((row) => this.renderRow(row))}</div>
      ${this.renderMore(group)}
    `;
  }

  /**
   * The line standing in for the rows `max_rows` folded away.
   *
   * A button rather than a note, because a count of what is hidden without a
   * way to see it is worse than not capping at all. Opening is one-way for the
   * life of the card: someone who asked to see the rest is not looking for a
   * way to hide them again.
   */
  private renderMore(group: RowGroup): TemplateResult | typeof nothing {
    if (!group.hidden) {
      return nothing;
    }

    return html`
      <button class="more" @click=${() => this.expandGroup(group.key)}>
        ${localize('common.show_more', '{count}', String(group.hidden))}
      </button>
    `;
  }

  private expandGroup(key: string): void {
    this.expanded = new Set(this.expanded).add(key);
  }

  private renderRow(row: DeviceRow): TemplateResult {
    const stateObj = row.stateEntity ? this.hass.states[row.stateEntity.entity_id] : undefined;
    const unavailable = isUnavailableState(stateObj?.state);

    return html`
      <div
        class="row ${unavailable ? 'unavailable' : ''} ${this.config.compact ? 'compact' : ''} tone-${this.tone(
          row.kind,
          stateObj,
        )}"
      >
        <div
          class="row-body"
          @action=${(ev: ActionHandlerEvent) => this.handleAction(ev, row)}
          ${actionHandler({
            hasHold: hasAction(this.config.hold_action),
            hasDoubleClick: hasAction(this.config.double_tap_action),
          })}
          tabindex="0"
          role="button"
        >
          ${this.config.show_icon ? this.renderIcon(row, stateObj) : nothing}
          <div class="text">
            <span class="name" title=${row.name}>${row.name}</span>
            ${this.renderSecondary(row, stateObj)}
          </div>
        </div>
        ${this.config.show_link ? this.renderLink(row, stateObj) : nothing}
        ${this.config.show_power ? this.renderPower(row) : nothing}
      </div>
    `;
  }

  /**
   * The colour family a row is drawn in.
   *
   * Kept to a handful of names rather than a colour per state so the palette
   * stays a theme concern: the CSS maps each tone onto a Home Assistant theme
   * variable, and a state nobody anticipated lands on the neutral one.
   *
   * Only kinds whose state says something about *running* are coloured. A disk
   * reporting `active` is naming its ATA power mode and a pool reports how full
   * it is — neither is good news or bad news, and colouring them drowns out the
   * containers, which are the reason to look at the card at all.
   */
  private tone(kind: MosDeviceKind, stateObj?: HassEntity): string {
    const state = stateObj?.state;

    if (state === undefined || isUnavailableState(state)) {
      return 'unknown';
    }

    if (kind === 'disk' || kind === 'storage_pool') {
      return 'neutral';
    }

    if (['running', 'on', 'active', 'ol', 'online'].includes(state.toLowerCase())) {
      return 'active';
    }

    if (['paused', 'frozen', 'standby', 'idle', 'sleeping', 'starting'].includes(state.toLowerCase())) {
      return 'idle';
    }

    return 'inactive';
  }

  /** The icon and whatever is badged onto it. */
  private renderIcon(row: DeviceRow, stateObj?: HassEntity): TemplateResult {
    return html`
      <div class="icon-wrap">
        ${this.renderArtwork(row, stateObj)}${this.renderProblemBadge(row)}${this.renderUpdateBadge(row)}
      </div>
    `;
  }

  /**
   * The mark on a device that is reporting a fault.
   *
   * Which of a device's binary sensors count is the integration's call, not
   * this card's: it sets Home Assistant's `problem` device class on exactly
   * those, and everything with that class and an outright "on" is badged. The
   * same rule as the update badge applies to the state — unknown and
   * unavailable mean the integration cannot currently say, which is not a
   * fault.
   *
   * It sits at the top of the icon where the update badge sits at the bottom,
   * so a container that is both unhealthy and out of date shows both.
   */
  private renderProblemBadge(row: DeviceRow): TemplateResult | typeof nothing {
    if (!this.config.show_problem) {
      return nothing;
    }

    const problems = row.problemCandidates
      .map((entity) => this.hass.states[entity.entity_id])
      .filter((stateObj) => stateObj?.attributes.device_class === 'problem' && stateObj.state === 'on');

    if (!problems.length) {
      return nothing;
    }

    // The entity's own name says what broke — "SMART warning", "Overload" —
    // where a generic word would only repeat what the colour already says. It
    // arrives prefixed with the device name, which the row is already headed
    // with, so that half is dropped.
    const label =
      problems
        .map((stateObj) => this.problemName(row, stateObj))
        .filter(Boolean)
        .join(', ') || localize('common.problem');

    return html`
      <div class="problem-badge" role="img" aria-label=${label} title=${label}>
        <ha-icon icon="mdi:alert"></ha-icon>
      </div>
    `;
  }

  /** A problem entity's name with the device name it is prefixed with removed. */
  private problemName(row: DeviceRow, stateObj: HassEntity): string {
    const full = (stateObj.attributes.friendly_name as string | undefined) ?? '';
    const device = row.device.name_by_user || row.device.name || '';

    return device && full.startsWith(`${device} `) ? full.slice(device.length + 1) : full;
  }

  /**
   * The row icon, in the order Home Assistant itself resolves one.
   *
   * 1. `entity_picture` — the artwork MOS shows for a Docker, LXC or VM guest,
   *    which beats any glyph either side could pick.
   * 2. The `icon` state attribute, for an entity that still sets one directly.
   * 3. What the integration declares in its `icons.json`. Those are resolved in
   *    the frontend and never reach a state attribute, so they are fetched
   *    separately — without this step the card silently ignores the icons the
   *    integration went to the trouble of declaring.
   * 4. The card's own per-kind icon, for the kinds the integration names none
   *    for and for the moment before the fetch lands.
   */
  private renderArtwork(row: DeviceRow, stateObj?: HassEntity): TemplateResult {
    const picture = stateObj?.attributes.entity_picture;

    if (picture) {
      return html`<img class="icon picture" src=${picture} alt="" loading="lazy" />`;
    }

    const icon =
      stateObj?.attributes.icon ||
      declaredIcon(this.icons, row.stateEntity, stateObj?.state) ||
      KIND_INFO[row.kind].icon;

    return html`<ha-icon class="icon" .icon=${icon}></ha-icon>`;
  }

  /**
   * The mark on a device whose image has a newer version waiting.
   *
   * It sits on the icon rather than next to the link and the switch, because
   * the right end of a row is where the controls are and this is not one.
   * Only Docker containers report updates — MOS tracks an image's local and
   * remote version, and no other kind has an equivalent — so every other row
   * finds no entity here and renders nothing.
   */
  private renderUpdateBadge(row: DeviceRow): TemplateResult | typeof nothing {
    if (!this.config.show_update || !row.updateEntity) {
      return nothing;
    }

    // Only an outright "on" earns the badge: unavailable and unknown mean the
    // integration cannot currently say, which is not the same as "up to date"
    // but is also no reason to tell someone to go and update something.
    if (this.hass.states[row.updateEntity.entity_id]?.state !== 'on') {
      return nothing;
    }

    const label = localize('common.update_available');

    return html`
      <div class="update-badge" role="img" aria-label=${label} title=${label}>
        <ha-icon icon="mdi:arrow-up"></ha-icon>
      </div>
    `;
  }

  /**
   * The line under the name: the state, the measurements, or both.
   *
   * They share one line rather than stacking, so a row keeps its height and the
   * card its density however many numbers are asked for. With nothing to say
   * the line is left out entirely instead of rendering empty.
   */
  private renderSecondary(row: DeviceRow, stateObj?: HassEntity): TemplateResult | typeof nothing {
    const parts: string[] = [];

    if (this.config.show_state) {
      parts.push(this.renderState(stateObj));
    }

    const metrics = this.formatMetrics(row.metricEntities);

    if (metrics) {
      parts.push(metrics);
    }

    if (!parts.length) {
      return nothing;
    }

    return html`<span class="state ${metrics ? 'with-metrics' : ''}">${parts.join(' · ')}</span>`;
  }

  /**
   * Measurements as one string, in the reading the rest of Home Assistant uses.
   *
   * A measurement the server cannot currently report — a stopped container has
   * no CPU figure, a virtualised disk no temperature — is left out rather than
   * printed as "unknown", which would fill the line with non-answers on exactly
   * the rows that have least to say.
   */
  private formatMetrics(entities: readonly EntityRegistryEntry[]): string {
    return entities
      .map((entity) => this.hass?.states[entity.entity_id])
      .filter((stateObj): stateObj is HassEntity => !!stateObj && !isUnavailableState(stateObj.state))
      .map((stateObj) => this.renderState(stateObj))
      .join(' · ');
  }

  private renderState(stateObj?: HassEntity): string {
    if (!stateObj) {
      return localize('common.no_state_entity');
    }

    // `formatEntityState` is the core's own formatter: it resolves the state
    // translations an integration declares under its entity's translation_key,
    // so a Docker container reads "Stopped" here exactly as it does in the
    // more-info dialog. `computeStateDisplay` from custom-card-helpers predates
    // translation_key enums and hands back the raw `exited`, so it is only the
    // fallback for cores too old to offer the former.
    const hass = this.hass as HomeAssistant & { formatEntityState?: (stateObj: HassEntity) => string };

    return hass.formatEntityState
      ? hass.formatEntityState(stateObj)
      : computeStateDisplay(this.hass.localize, stateObj, this.hass.locale);
  }

  /**
   * A link out to the thing itself.
   *
   * `web_ui_url` on the Docker state sensor is the container's own web
   * interface, and the integration omits the attribute entirely for containers
   * that have none — so its presence is the test. The device's configuration
   * URL is the fallback, which is what the other kinds have.
   */
  private renderLink(row: DeviceRow, stateObj?: HassEntity): TemplateResult | typeof nothing {
    const url = (stateObj?.attributes.web_ui_url as string | undefined) || row.device.configuration_url || undefined;

    if (!url) {
      return nothing;
    }

    return html`
      <a class="link" href=${url} target="_blank" rel="noreferrer noopener" title=${localize('common.open_link')}>
        <ha-icon icon="mdi:web"></ha-icon>
      </a>
    `;
  }

  private renderPower(row: DeviceRow): TemplateResult | typeof nothing {
    if (!row.powerEntity) {
      return nothing;
    }

    const switchObj = this.hass.states[row.powerEntity.entity_id];

    if (!switchObj) {
      return nothing;
    }

    const on = switchObj.state === 'on';
    const waiting = this.pending.has(row.powerEntity.entity_id);
    const disabled = isUnavailableState(switchObj.state) || waiting;
    const label = localize(waiting ? 'common.power_pending' : 'common.toggle_power');

    // A toggle reads as a setting that is either on or off; a guest is a thing
    // that is doing something right now. So the control is a button showing the
    // action it performs — start what is stopped, stop what is running — and,
    // while the server works on it, that the press was heard.
    return html`
      <button
        class="power-button ${waiting ? 'pending' : ''}"
        ?disabled=${disabled}
        title=${label}
        aria-label=${label}
        @click=${(ev: Event) => this.togglePower(ev, row)}
      >
        ${
          waiting
            ? html`<span class="spinner" role="progressbar"></span>`
            : html`<ha-icon icon=${on ? 'mdi:stop' : 'mdi:play'}></ha-icon>`
        }
      </button>
    `;
  }

  private togglePower(ev: Event, row: DeviceRow): void {
    ev.stopPropagation();

    if (!row.powerEntity) {
      return;
    }

    const entityId = row.powerEntity.entity_id;

    if (this.pending.has(entityId)) {
      return;
    }

    // Derived from the entity rather than from the widget, because the two
    // controls report differently: the switch has already flipped its own
    // `checked` by the time this fires, a button has no such state at all.
    const current = this.hass.states[entityId]?.state;
    const stopping = current === 'on';

    // `confirm` rather than a Home Assistant dialog: the dialog has to be
    // imported from the frontend to be opened, which a card loaded as a
    // resource cannot do. It is also what `custom-card-helpers` uses for the
    // `confirmation` option on an action, so the two read the same.
    if (stopping && this.config.confirm_stop && !confirm(localize('common.confirm_stop', '{name}', row.name))) {
      return;
    }

    this.markPending(entityId, current);

    this.hass
      .callService('switch', stopping ? 'turn_off' : 'turn_on', { entity_id: entityId })
      .catch(() => this.clearPending(entityId));
  }

  /** Start waiting on a switch, with a timeout so the wait always ends. */
  private markPending(entityId: string, state: string | undefined): void {
    this.pending = new Map(this.pending).set(entityId, state ?? '');
    this.pendingTimers.set(
      entityId,
      setTimeout(() => this.clearPending(entityId), PENDING_TIMEOUT_MS),
    );
  }

  private clearPending(entityId: string): void {
    const timer = this.pendingTimers.get(entityId);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.pendingTimers.delete(entityId);
    }

    if (this.pending.has(entityId)) {
      const next = new Map(this.pending);
      next.delete(entityId);
      this.pending = next;
    }
  }

  private clearPendingTimers(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.pending = new Map();
  }

  /** The action the config names for one of the three gestures. */
  private configuredAction(action: string): ActionConfig | undefined {
    if (action === 'hold') {
      return this.config?.hold_action;
    }

    if (action === 'double_tap') {
      return this.config?.double_tap_action;
    }

    return this.config?.tap_action;
  }

  /**
   * Route a row action.
   *
   * The configured actions are card-wide, but each row applies them to its own
   * state entity — so a single `tap_action: more-info` opens the dialog for
   * whichever container was tapped.
   *
   * `toggle` is the one action that cannot mean the state entity: that entity
   * is a sensor, and Home Assistant would go looking for `sensor.turn_off`.
   * What someone picking `toggle` means is the switch the row already offers as
   * its power button, so the action is pointed at that instead. A row without
   * one — a disk, a pool, the UPS — has nothing to toggle and does nothing,
   * rather than reporting an entity Home Assistant cannot act on.
   */
  private handleAction(ev: ActionHandlerEvent, row: DeviceRow): void {
    if (!this.hass || !this.config || !ev.detail?.action) {
      return;
    }

    const toggling = this.configuredAction(ev.detail.action)?.action === 'toggle';

    if (toggling && !row.powerEntity) {
      return;
    }

    handleAction(
      this,
      this.hass,
      {
        entity: toggling ? row.powerEntity?.entity_id : row.stateEntity?.entity_id,
        tap_action: this.config.tap_action,
        hold_action: this.config.hold_action,
        double_tap_action: this.config.double_tap_action,
      },
      ev.detail.action,
    );
  }
  static get styles(): CSSResultGroup {
    return css`
      .card-content {
        padding: 4px 12px 12px;
        /* The column layout below asks about the card's own width, not the
           window's: the same card is wide in one dashboard column and narrow in
           three, and only a container query can tell the difference. */
        container-type: inline-size;
      }

      .notice {
        padding: 16px 0;
        color: var(--secondary-text-color);
        text-align: center;
      }

      .server-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin: 14px 4px 6px;
        font-weight: 500;
        color: var(--primary-text-color);
      }

      /* Right of the name and quieter than it: the server's load is context for
         the rows below, not a heading of its own. */
      .server-summary {
        flex: 0 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.85em;
        font-weight: 400;
        color: var(--secondary-text-color);
      }

      .kind-heading {
        margin: 14px 4px 6px;
        font-size: 0.75em;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--secondary-text-color);
      }

      .group {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }

      .group.cols-2 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .group.cols-3 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .group.cols-4 {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      /* A row needs roughly 220px before its name turns to ellipsis, so the
         asked-for count is given up in steps rather than all at once. */
      @container (max-width: 900px) {
        .group.cols-4 {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @container (max-width: 680px) {
        .group.cols-3,
        .group.cols-4 {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @container (max-width: 440px) {
        .group.cols-2,
        .group.cols-3,
        .group.cols-4 {
          grid-template-columns: 1fr;
        }
      }

      /* Opens the rows the cap folded away. Sized and coloured like the kind
         headings rather than like a row, so it reads as part of the list's
         furniture and not as another device. */
      .more {
        justify-self: start;
        margin: 8px 4px 0;
        padding: 4px 8px;
        border: none;
        border-radius: 8px;
        background: none;
        cursor: pointer;
        font: inherit;
        font-size: 0.8em;
        font-weight: 500;
        color: var(--secondary-text-color);
      }

      .more:hover {
        color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 12%, transparent);
      }

      .more:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 1px;
      }

      /* Every row carries a tone class derived from its state; these map it onto
         the theme's own colours, so a custom theme recolours the card without
         the card knowing anything about it. */
      .row {
        --tone-color: var(--secondary-text-color);
        /* Lifted off the card by mixing the text colour into the card's own
           background: a fixed grey would sit invisibly on the card in one theme
           or the other, and this stays a step darker in light and a step lighter
           in dark without needing to know which is in use. Named so the update
           badge can cut its ring out of the same colour. */
        --row-background: color-mix(
          in srgb,
          var(--primary-text-color) 7%,
          var(--ha-card-background, var(--card-background-color))
        );
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        min-height: 56px;
        border-radius: 14px;
        box-sizing: border-box;
        background: var(--row-background);
      }

      /* Everything shrinks together, so the row keeps its proportions and does
         not just look like a squashed version of itself. */
      .row.compact {
        gap: 8px;
        padding: 4px 8px;
        min-height: 40px;
        border-radius: 10px;
      }

      .row.compact .icon {
        width: 32px;
        height: 32px;
        padding: 5px;
        border-radius: 9px;
        --mdc-icon-size: 20px;
      }

      .row.compact .link,
      .row.compact .power-button {
        width: 28px;
        height: 28px;
        --mdc-icon-size: 16px;
      }

      .row.compact .update-badge,
      .row.compact .problem-badge {
        width: 14px;
        height: 14px;
        border-width: 1.5px;
        --mdc-icon-size: 8px;
      }

      .row.compact .spinner {
        width: 13px;
        height: 13px;
      }

      .row.tone-active {
        --tone-color: var(--success-color, var(--state-active-color, #43a047));
      }

      .row.tone-idle {
        --tone-color: var(--warning-color, #ffa726);
      }

      .row.tone-inactive {
        --tone-color: var(--state-inactive-color, var(--secondary-text-color));
      }

      .row.tone-unknown {
        --tone-color: var(--disabled-color, var(--secondary-text-color));
      }

      .row.tone-neutral {
        --tone-color: var(--state-icon-color, var(--secondary-text-color));
      }

      /* The secondary line only takes the tone colour where the tone means
         something; on a neutral row it is ordinary secondary text. */
      .row.tone-neutral .state,
      .row.tone-inactive .state,
      .row.tone-unknown .state {
        color: var(--secondary-text-color);
      }

      .row.unavailable {
        opacity: 0.6;
      }

      .row-body {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        min-width: 0;
        cursor: pointer;
        border-radius: 10px;
        outline: none;
      }

      .row-body:focus-visible {
        box-shadow: 0 0 0 2px var(--primary-color);
      }

      /* The icon well.
         A rounded square rather than a circle, because most of what lands here
         is a square app logo from the MOS template and a circle clips its
         corners. The tone is carried by a ring around the well instead of a
         wash behind the artwork, which would drain the colour out of it. */
      .icon {
        flex: 0 0 auto;
        width: 44px;
        height: 44px;
        padding: 8px;
        box-sizing: border-box;
        border-radius: 12px;
        color: var(--tone-color);
        background: color-mix(in srgb, var(--tone-color) 16%, transparent);
        --mdc-icon-size: 28px;
      }

      /* The ring is the state signal, so it is only drawn where the state is
         one — otherwise it reads as a stray border around every icon. */
      .row.tone-active .icon,
      .row.tone-idle .icon {
        box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--tone-color) 35%, transparent);
      }

      /* Holds the icon and the badge together. The icon keeps its own box, so
         nothing about its size or spacing changes when no badge is drawn. */
      .icon-wrap {
        position: relative;
        flex: 0 0 auto;
        display: inline-flex;
      }

      .update-badge,
      .problem-badge {
        position: absolute;
        right: -3px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        box-sizing: border-box;
        border-radius: 50%;
        /* The ring is the row's own background, which lifts the badge off the
           icon instead of letting it merge into the corner of a dark logo. */
        border: 2px solid var(--row-background);
        color: var(--text-primary-color, #fff);
        --mdc-icon-size: 10px;
      }

      .update-badge {
        bottom: -3px;
        background: var(--warning-color, #ffa726);
      }

      /* Opposite corner from the update badge, so a container that is both
         unhealthy and out of date shows both without them overlapping. Error
         rather than warning: this one is not a suggestion. */
      .problem-badge {
        top: -3px;
        background: var(--error-color, #db4437);
      }

      /* Artwork gets a neutral well and more room: it brings its own colours,
         and a tinted backdrop behind a logo reads as a stain. */
      .icon.picture {
        padding: 5px;
        object-fit: contain;
        background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
      }

      .text {
        display: flex;
        flex-direction: column;
        justify-content: center;
        flex: 1;
        min-width: 0;
        gap: 1px;
      }

      .name {
        width: 100%;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
        line-height: 1.3;
        color: var(--primary-text-color);
      }

      .state {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.85em;
        line-height: 1.3;
        color: var(--tone-color);
      }

      /* A state on its own is a word that can be cut without losing much; a
         measurement cut in half is the one thing the reader asked for and did
         not get. So a line carrying numbers wraps instead, to at most two lines
         — which only happens on a card too narrow to hold them side by side. */
      .state.with-metrics {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        white-space: normal;
      }

      /* Controls sit in matching round wells so the row ends in a consistent
         shape whether a device has a link, a switch, both or neither. */
      .link,
      .power-button {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        padding: 0;
        border: none;
        border-radius: 50%;
        --mdc-icon-size: 20px;
      }

      .link {
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      }

      .link:hover {
        color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 18%, transparent);
      }

      .power-button {
        cursor: pointer;
        color: var(--tone-color);
        background: color-mix(in srgb, var(--tone-color) 16%, transparent);
        transition: background 0.15s ease-in-out;
      }

      .power-button:hover {
        background: color-mix(in srgb, var(--tone-color) 30%, transparent);
      }

      .power-button:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 1px;
      }

      .power-button:disabled {
        cursor: default;
        opacity: 0.5;
      }

      /* A waiting button is disabled so it cannot be pressed twice, but it is
         not dimmed like an unavailable one — it is the row's liveliest thing
         at that moment, and fading it says the opposite. */
      .power-button.pending {
        opacity: 1;
      }

      .spinner {
        width: 16px;
        height: 16px;
        box-sizing: border-box;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--tone-color) 25%, transparent);
        border-top-color: var(--tone-color);
        animation: mos-spin 0.8s linear infinite;
      }

      @keyframes mos-spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* Slowed rather than stopped: a spinner that does not turn says nothing
         at all, which is the one thing this element exists to avoid. */
      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation-duration: 2.4s;
        }
      }
    `;
  }
}
