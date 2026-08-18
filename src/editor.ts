import { LitElement, html, TemplateResult, css, CSSResultGroup, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor, fireEvent } from 'custom-card-helpers';
import type { UnsubscribeFunc } from 'home-assistant-js-websocket';

import type { MosCardConfig } from './types';
import { DeviceRegistryEntry, MOS_DEVICE_KINDS, findServerDevices, subscribeDeviceRegistry } from './devices';
import { localize } from './localize/localize';

/** The boolean options, each rendered as its own switch. */
const TOGGLES = ['group_by_kind', 'show_icon', 'show_state', 'show_link', 'show_power', 'hide_unavailable'] as const;

/** One entry of an `ha-form` schema. Home Assistant types this internally. */
interface FormSchema {
  name: string;
  selector: Record<string, unknown>;
}

@customElement('mos-card-editor')
export class MosCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: MosCardConfig;

  /**
   * The MOS servers to offer in the picker.
   *
   * Derived from the same device registry the card reads, so a server that
   * appears or goes away is reflected here without reopening the editor.
   */
  @state() private _servers: DeviceRegistryEntry[] = [];

  private _unsubscribe?: UnsubscribeFunc;

  public setConfig(config: MosCardConfig): void {
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

  /**
   * The form description Home Assistant renders from.
   *
   * `ha-form` is the supported way to build a card editor: Home Assistant maps
   * each selector onto whatever widget its current frontend uses, so the editor
   * follows the frontend instead of pinning itself to one generation of it.
   * Driving `ha-select` and `mwc-list-item` by hand is what broke the server
   * picker — `ha-select` was reimplemented on a different base and stopped
   * emitting the event this editor listened for, leaving a dropdown that opened,
   * listed both servers and did nothing at all when one was clicked.
   */
  private _schema(): FormSchema[] {
    return [
      { name: 'title', selector: { text: {} } },
      {
        name: 'server',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: '', label: localize('editor.all_servers') },
              ...this._servers.map((server) => ({
                value: server.id,
                label: server.name_by_user || server.name || server.id,
              })),
            ],
          },
        },
      },
      {
        name: 'kinds',
        selector: {
          select: {
            multiple: true,
            options: MOS_DEVICE_KINDS.map((kind) => ({ value: kind, label: localize(`kinds.${kind}`) })),
          },
        },
      },
      ...TOGGLES.map((option) => ({ name: option, selector: { boolean: {} } })),
    ];
  }

  /**
   * The config as the form wants it: every key present, defaults filled in.
   *
   * Defaults here must match the ones the card's `setConfig` applies, or the
   * editor shows one thing while the card does another.
   */
  private _data(config: MosCardConfig): Record<string, unknown> {
    const data: Record<string, unknown> = {
      title: config.title ?? '',
      server: config.server ?? '',
      kinds: config.kinds ?? [...MOS_DEVICE_KINDS],
    };

    for (const option of TOGGLES) {
      const value = config[option];
      data[option] = typeof value === 'boolean' ? value : option !== 'hide_unavailable';
    }

    return data;
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this._config || !this.hass) {
      return nothing;
    }

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._data(this._config)}
        .schema=${this._schema()}
        .computeLabel=${this._computeLabel}
        .computeHelper=${this._computeHelper}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  private _computeLabel = (schema: FormSchema): string => localize(`editor.${schema.name}`);

  private _computeHelper = (schema: FormSchema): string =>
    schema.name === 'kinds' ? localize('editor.kinds_hint') : '';

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) {
      return;
    }

    const value = ev.detail.value as Record<string, unknown>;
    const config: MosCardConfig = { ...this._config, ...value } as MosCardConfig;

    // The form has to hand back a value for every key it renders, so the two
    // optional ones arrive as empty strings when cleared. Lovelace would write
    // those into the YAML as empty keys, so they are dropped rather than stored.
    if (!value.title) {
      delete config.title;
    }
    if (!value.server) {
      delete config.server;
    }

    fireEvent(this, 'config-changed', { config });
  }

  static get styles(): CSSResultGroup {
    return css`
      ha-form {
        display: block;
      }
    `;
  }
}

if (!customElements.get('mos-card-editor')) {
  customElements.define('mos-card-editor', MosCardEditor);
}
