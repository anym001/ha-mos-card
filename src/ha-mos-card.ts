import { LitElement, html, nothing, TemplateResult, css, CSSResultGroup, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HassEntity } from 'home-assistant-js-websocket';
import type { UnsubscribeFunc } from 'home-assistant-js-websocket';
import {
  HomeAssistant,
  hasAction,
  ActionHandlerEvent,
  handleAction,
  LovelaceCardEditor,
  computeStateDisplay,
} from 'custom-card-helpers';

import type { HaMosCardConfig } from './types';
import {
  DeviceRegistryEntry,
  EntityRegistryEntry,
  KIND_INFO,
  MOS_DEVICE_KINDS,
  MosDeviceKind,
  deviceDisplayName,
  entitiesByDevice,
  findPowerEntity,
  findServerDevices,
  findStateEntity,
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
  `%c  HA-MOS-CARD \n%c  ${localize('common.version')} ${CARD_VERSION}    `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

interface WindowWithCustomCards extends Window {
  customCards: Array<{ type: string; name: string; description: string }>;
}

(window as unknown as WindowWithCustomCards).customCards =
  (window as unknown as WindowWithCustomCards).customCards || [];
(window as unknown as WindowWithCustomCards).customCards.push({
  type: 'ha-mos-card',
  name: 'MOS NAS Card',
  description: 'Containers, VMs, disks, pools and the UPS of a MOS NAS server',
});

/** One rendered line: a device plus the entities the row is built from. */
interface DeviceRow {
  device: DeviceRegistryEntry;
  kind: MosDeviceKind;
  name: string;
  stateEntity?: EntityRegistryEntry;
  powerEntity?: EntityRegistryEntry;
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

@customElement('ha-mos-card')
export class HaMosCard extends LitElement {
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./editor');
    return document.createElement('ha-mos-card-editor');
  }

  public static getStubConfig(): Record<string, unknown> {
    return { kinds: [...MOS_DEVICE_KINDS] };
  }

  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private config!: HaMosCardConfig;

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

  private unsubscribe: UnsubscribeFunc[] = [];

  private trackedCache?: {
    devices?: DeviceRegistryEntry[];
    entities?: EntityRegistryEntry[];
    config: HaMosCardConfig;
    ids: string[];
  };

  public setConfig(config: HaMosCardConfig): void {
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

    if (changedProps.has('config') || changedProps.has('devices') || changedProps.has('entities')) {
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
      ${group.rows.map((row) => this.renderRow(row))}
    `;
  }

  private renderRow(row: DeviceRow): TemplateResult {
    const stateObj = row.stateEntity ? this.hass.states[row.stateEntity.entity_id] : undefined;
    const unavailable = isUnavailableState(stateObj?.state);

    return html`
      <div class="row ${unavailable ? 'unavailable' : ''}">
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
   * The row icon.
   *
   * The state sensor of a Docker, LXC or VM guest carries the icon MOS itself
   * shows for it as `entity_picture`, which beats any generic icon this card
   * could pick. Kinds without one — and guests whose template has no icon —
   * fall back to the per-kind MDI icon.
   */
  private renderIcon(row: DeviceRow, stateObj?: HassEntity): TemplateResult {
    const picture = stateObj?.attributes.entity_picture;

    if (picture) {
      return html`<img class="icon picture" src=${picture} alt="" loading="lazy" />`;
    }

    return html`<ha-icon class="icon" .icon=${stateObj?.attributes.icon || KIND_INFO[row.kind].icon}></ha-icon>`;
  }

  private renderState(stateObj?: HassEntity): string {
    if (!stateObj) {
      return localize('common.no_state_entity');
    }

    // computeStateDisplay applies the user's own translations, units and
    // precision, so an enum state reads the way it does everywhere else in
    // Home Assistant rather than as the integration's raw string.
    return computeStateDisplay(this.hass.localize, stateObj, this.hass.locale);
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
        <ha-icon icon="mdi:open-in-new"></ha-icon>
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

    return html`
      <ha-switch
        .checked=${switchObj.state === 'on'}
        .disabled=${isUnavailableState(switchObj.state)}
        title=${localize('common.toggle_power')}
        @change=${(ev: Event) => this.togglePower(ev, row)}
      ></ha-switch>
    `;
  }

  private togglePower(ev: Event, row: DeviceRow): void {
    ev.stopPropagation();

    if (!row.powerEntity) {
      return;
    }

    const target = ev.target as HTMLInputElement;

    this.hass.callService('switch', target.checked ? 'turn_on' : 'turn_off', {
      entity_id: row.powerEntity.entity_id,
    });
  }

  /**
   * Route a row action.
   *
   * The configured actions are card-wide, but each row applies them to its own
   * state entity — so a single `tap_action: more-info` opens the dialog for
   * whichever container was tapped.
   */
  private handleAction(ev: ActionHandlerEvent, row: DeviceRow): void {
    if (!this.hass || !this.config || !ev.detail?.action) {
      return;
    }

    handleAction(
      this,
      this.hass,
      {
        entity: row.stateEntity?.entity_id,
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
        padding: 8px 16px 16px;
      }

      .notice {
        padding: 16px 0;
        color: var(--secondary-text-color);
        text-align: center;
      }

      .server-heading {
        margin: 12px 0 4px;
        font-weight: 500;
        color: var(--primary-text-color);
      }

      .kind-heading {
        margin: 12px 0 2px;
        font-size: 0.85em;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--secondary-text-color);
      }

      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
      }

      .row.unavailable {
        opacity: 0.5;
      }

      .row-body {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        min-width: 0;
        cursor: pointer;
        border-radius: 4px;
        outline: none;
      }

      .row-body:focus-visible {
        box-shadow: 0 0 0 2px var(--primary-color);
      }

      .icon {
        flex: 0 0 auto;
        width: 24px;
        height: 24px;
        color: var(--state-icon-color, var(--paper-item-icon-color));
      }

      .icon.picture {
        object-fit: contain;
        border-radius: 4px;
      }

      .text {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }

      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .state {
        flex: 0 0 auto;
        color: var(--secondary-text-color);
        text-align: right;
      }

      .link {
        flex: 0 0 auto;
        display: inline-flex;
        color: var(--secondary-text-color);
      }

      .link:hover {
        color: var(--primary-color);
      }

      ha-switch {
        flex: 0 0 auto;
      }
    `;
  }
}
