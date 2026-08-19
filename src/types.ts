import { ActionConfig, LovelaceCardConfig, LovelaceCardEditor } from 'custom-card-helpers';

import type { MosDeviceKind, RowSort, SecondaryInfo } from './devices';

declare global {
  interface HTMLElementTagNameMap {
    'mos-card-editor': LovelaceCardEditor;
  }
}

export interface MosCardConfig extends LovelaceCardConfig {
  type: string;

  /** Card heading. Omit for no heading. */
  title?: string;

  /**
   * Device id of the MOS server whose devices to show.
   *
   * Omit to show every MOS server Home Assistant knows about, grouped by
   * server. With a single server configured — the common case — omitting this
   * and setting it are equivalent.
   */
  server?: string;

  /**
   * Which device kinds to render, matched against the device's `model_id`.
   *
   * Defaults to all six. Kinds with no devices render nothing, so the default
   * shows whatever the server actually has.
   */
  kinds?: MosDeviceKind[];

  /** Group rows under a heading per kind. Default true. */
  group_by_kind?: boolean;

  /**
   * The order rows are listed in within a group. Default `name`.
   *
   * `state` puts what is running first, then what is paused, then what is
   * stopped, alphabetically within each — the order that answers "what is up
   * right now" without reading every row. Kinds whose state says nothing about
   * running, disks and pools, stay alphabetical under both.
   */
  sort?: RowSort;

  /**
   * A measurement to show beside each row's state. Default `none`.
   *
   * `auto` picks per kind: CPU and memory for a guest, temperature for a disk,
   * free space for a pool, load for the UPS. `cpu` and `memory` ask for one
   * specific number and resolve to nothing on the kinds that have no such
   * thing. A measurement the server cannot currently report is left out rather
   * than printed as unknown.
   */
  secondary_info?: SecondaryInfo;

  /** Show the state entity's icon or MOS template picture. Default true. */
  show_icon?: boolean;

  /** Show the state value on each row. Default true. */
  show_state?: boolean;

  /**
   * Show a link button for rows that have one — the container's `web_ui_url`,
   * falling back to the device's configuration URL. Default true.
   */
  show_link?: boolean;

  /** Show the start/stop switch on guest rows. Default true. */
  show_power?: boolean;

  /**
   * Ask before stopping a running guest. Default false.
   *
   * Only the stop direction asks. Starting something is cheap and undone by a
   * second click; stopping a VM someone is working in is neither, and the
   * button sits right next to the link button.
   */
  confirm_stop?: boolean;

  /**
   * Show a badge on rows whose device reports a waiting update. Default true.
   *
   * The badge sits on the row's icon, so it needs `show_icon` as well. Only
   * Docker containers report updates at all.
   */
  show_update?: boolean;

  /**
   * Hide rows whose state is unavailable or unknown. Default false.
   *
   * Off by default on purpose: a device behind a failing MOS endpoint keeps its
   * registry entry and only reports unavailable, and that is worth seeing.
   */
  hide_unavailable?: boolean;

  /** Action for a tap on the row body. Default `more-info` on the state entity. */
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

/**
 * What a card tells the sections view about the space it wants.
 *
 * Declared here rather than imported: `custom-card-helpers` predates the
 * sections layout and types nothing for it, so this follows the frontend's own
 * shape. `'full'` spans the section's twelve columns and `'auto'` lets the card
 * take the height its content needs.
 */
export interface LovelaceGridOptions {
  columns?: number | 'full';
  rows?: number | 'auto';
  min_columns?: number;
  min_rows?: number;
  max_columns?: number;
  max_rows?: number;
}
