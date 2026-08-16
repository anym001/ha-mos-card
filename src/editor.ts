import { LitElement, html, TemplateResult, css, CSSResultGroup, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor, fireEvent } from 'custom-card-helpers';
import type { UnsubscribeFunc } from 'home-assistant-js-websocket';

import type { HaMosCardConfig } from './types';
import { DeviceRegistryEntry, MOS_DEVICE_KINDS, findServerDevices, subscribeDeviceRegistry } from './devices';
import { localize } from './localize/localize';

/** The boolean options, rendered as one switch each. */
const TOGGLES = ['group_by_kind', 'show_icon', 'show_state', 'show_link', 'show_power', 'hide_unavailable'] as const;

type Toggle = (typeof TOGGLES)[number];

@customElement('ha-mos-card-editor')
export class HaMosCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: HaMosCardConfig;

  /**
   * The MOS servers to offer in the picker.
   *
   * Derived from the same device registry the card reads, so a server that
   * appears or goes away is reflected here without reopening the editor.
   */
  @state() private _servers: DeviceRegistryEntry[] = [];

  private _unsubscribe?: UnsubscribeFunc;

  public setConfig(config: HaMosCardConfig): void {
    this._config = config;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._subscribe();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  protected updated(changedProps: Map<string, unknown>): void {
    if (changedProps.has('hass')) {
      this._subscribe();
    }
  }

  private _subscribe(): void {
    if (this._unsubscribe || !this.hass?.connection) {
      return;
    }

    this._unsubscribe = subscribeDeviceRegistry(this.hass.connection, (devices) => {
      this._servers = findServerDevices(devices);
    });
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this._config || !this.hass) {
      return nothing;
    }

    const kinds = this._config.kinds ?? [...MOS_DEVICE_KINDS];

    return html`
      <div class="editor">
        <ha-textfield
          .label=${localize('editor.title')}
          .value=${this._config.title ?? ''}
          @input=${this._titleChanged}
        ></ha-textfield>

        <ha-select
          .label=${localize('editor.server')}
          .value=${this._config.server ?? ''}
          naturalMenuWidth
          fixedMenuPosition
          @selected=${this._serverChanged}
          @closed=${(ev: Event) => ev.stopPropagation()}
        >
          <mwc-list-item value="">${localize('editor.all_servers')}</mwc-list-item>
          ${this._servers.map(
            (server) =>
              html`<mwc-list-item .value=${server.id}
                >${server.name_by_user || server.name || server.id}</mwc-list-item
              >`,
          )}
        </ha-select>

        <div class="section-label">${localize('editor.kinds')}</div>
        <div class="hint">${localize('editor.kinds_hint')}</div>
        ${MOS_DEVICE_KINDS.map(
          (kind) => html`
            <ha-formfield .label=${localize(`kinds.${kind}`)}>
              <ha-checkbox .checked=${kinds.includes(kind)} .value=${kind} @change=${this._kindChanged}></ha-checkbox>
            </ha-formfield>
          `,
        )}

        <div class="section-label">${localize('editor.display')}</div>
        ${TOGGLES.map(
          (option) => html`
            <ha-formfield .label=${localize(`editor.${option}`)}>
              <ha-switch
                .checked=${this._toggleValue(option)}
                .value=${option}
                @change=${this._toggleChanged}
              ></ha-switch>
            </ha-formfield>
          `,
        )}
      </div>
    `;
  }

  /** Defaults here must match the ones setConfig applies, or the editor lies. */
  private _toggleValue(option: Toggle): boolean {
    const value = this._config?.[option];

    if (typeof value === 'boolean') {
      return value;
    }

    return option !== 'hide_unavailable';
  }

  private _titleChanged(ev: Event): void {
    const value = (ev.target as HTMLInputElement).value;
    this._emit({ title: value || undefined });
  }

  private _serverChanged(ev: Event): void {
    const value = (ev.target as HTMLSelectElement).value;

    if (value === (this._config?.server ?? '')) {
      return;
    }

    this._emit({ server: value || undefined });
  }

  private _kindChanged(ev: Event): void {
    if (!this._config) {
      return;
    }

    const target = ev.target as HTMLInputElement;
    const kind = target.value as (typeof MOS_DEVICE_KINDS)[number];
    const current = new Set(this._config.kinds ?? MOS_DEVICE_KINDS);

    if (target.checked) {
      current.add(kind);
    } else {
      current.delete(kind);
    }

    // Keep the declared order rather than click order, so the config reads the
    // same way however the boxes were ticked — and so the card renders groups
    // in a stable order.
    this._emit({ kinds: MOS_DEVICE_KINDS.filter((candidate) => current.has(candidate)) });
  }

  private _toggleChanged(ev: Event): void {
    const target = ev.target as HTMLInputElement;
    this._emit({ [target.value as Toggle]: target.checked });
  }

  private _emit(patch: Partial<HaMosCardConfig>): void {
    if (!this._config) {
      return;
    }

    const config: HaMosCardConfig = { ...this._config, ...patch };

    // Undefined survives a spread, and Lovelace would serialize it into the
    // YAML as an empty key, so strip anything cleared back out.
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete config[key];
      }
    }

    fireEvent(this, 'config-changed', { config });
  }

  static get styles(): CSSResultGroup {
    return css`
      .editor {
        display: flex;
        flex-direction: column;
      }

      ha-textfield,
      ha-select {
        width: 100%;
        margin-bottom: 12px;
      }

      .section-label {
        margin: 12px 0 4px;
        font-weight: 500;
      }

      .hint {
        margin-bottom: 4px;
        color: var(--secondary-text-color);
        font-size: 0.85em;
      }

      ha-formfield {
        display: block;
        padding: 2px 0;
      }
    `;
  }
}

if (!customElements.get('ha-mos-card-editor')) {
  customElements.define('ha-mos-card-editor', HaMosCardEditor);
}
