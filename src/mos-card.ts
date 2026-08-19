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
  declaredIcon,
  deviceDisplayName,
  entitiesByDevice,
  fetchIntegrationIcons,
  findPowerEntity,
  findServerDevices,
  findStateEntity,
  findUpdateEntity,
  isMosDeviceKind,
  isUnavailableState,
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
}

/** Rows of one kind, under one server. */
interface RowGroup {
  kind: MosDeviceKind;
  rows: DeviceRow[];
}

/** Everything belonging to one MOS server. */
interface ServerSection {
  server?: DeviceRegistryEntry;
  groups: RowGroup[];
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

    this.config = {
      kinds: [...MOS_DEVICE_KINDS],
      group_by_kind: true,
      show_icon: true,
      show_state: true,
      show_link: true,
      show_power: true,
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
      changedProps.has('pending')
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
            };
          })
          .filter((row) => !this.config.hide_unavailable || !isUnavailableState(this.stateValue(row)))
          .sort((left, right) => left.name.localeCompare(right.name));

        if (rows.length) {
          groups.push({ kind, rows });
        }
      }

      if (groups.length) {
        sections.push({ server, groups });
      }
    }

    return sections;
  }

  private stateValue(row: DeviceRow): string | undefined {
    return row.stateEntity ? this.hass?.states[row.stateEntity.entity_id]?.state : undefined;
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

    return html`
      ${showServerHeading ? html`<div class="server-heading">${heading}</div>` : nothing}
      ${section.groups.map((group) => this.renderGroup(group))}
    `;
  }

  private renderGroup(group: RowGroup): TemplateResult {
    return html`
      ${this.config.group_by_kind ? html`<div class="kind-heading">${localize(`kinds.${group.kind}`)}</div>` : nothing}
      <div class="group">${group.rows.map((row) => this.renderRow(row))}</div>
    `;
  }

  private renderRow(row: DeviceRow): TemplateResult {
    const stateObj = row.stateEntity ? this.hass.states[row.stateEntity.entity_id] : undefined;
    const unavailable = isUnavailableState(stateObj?.state);

    return html`
      <div class="row ${unavailable ? 'unavailable' : ''} tone-${this.tone(row.kind, stateObj)}">
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
            ${this.config.show_state ? html`<span class="state">${this.renderState(stateObj)}</span>` : nothing}
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
    return html`<div class="icon-wrap">${this.renderArtwork(row, stateObj)}${this.renderUpdateBadge(row)}</div>`;
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

    this.markPending(entityId, current);

    this.hass
      .callService('switch', current === 'on' ? 'turn_off' : 'turn_on', { entity_id: entityId })
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
      }

      .notice {
        padding: 16px 0;
        color: var(--secondary-text-color);
        text-align: center;
      }

      .server-heading {
        margin: 14px 4px 6px;
        font-weight: 500;
        color: var(--primary-text-color);
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
        display: flex;
        flex-direction: column;
        gap: 8px;
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

      .update-badge {
        position: absolute;
        right: -3px;
        bottom: -3px;
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
        background: var(--warning-color, #ffa726);
        --mdc-icon-size: 10px;
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
