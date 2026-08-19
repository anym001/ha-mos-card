import { ActionConfig, LovelaceCardConfig, LovelaceCardEditor } from 'custom-card-helpers';

import type { MosDeviceKind } from './devices';

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
