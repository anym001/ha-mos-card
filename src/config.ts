/**
 * The card's configuration: its defaults, its validation, and the two
 * conversions the editor needs.
 *
 * Kept out of the component on purpose. Defaults and validation are the one
 * part of the config that both the card and its editor have to agree on — the
 * editor showing a switch as off while the card behaves as on is a bug class of
 * its own — and a single exported object is a stronger guarantee of that than
 * two lists that have to be kept in step. It is also all pure, so it can be
 * tested without a DOM.
 */
import { MOS_DEVICE_KINDS, ROW_SORTS, SECONDARY_INFO_MODES, isMosDeviceKind } from './devices';
import type { NameFilter } from './devices';
import type { MosCardConfig } from './types';
import { localize } from './localize/localize';

/** The largest `columns` the layout has styles for. */
export const MAX_COLUMNS = 4;

/**
 * What the card does when the config says nothing.
 *
 * Read by both `setConfig` and the editor's form data, so there is one answer
 * to "what is this option when untouched" rather than two.
 */
export const CARD_DEFAULTS = {
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
} as const satisfies Partial<MosCardConfig>;

/**
 * The boolean options, in the order the editor offers them.
 *
 * Lives beside the defaults rather than in the editor so the two cannot drift:
 * a boolean added to `CARD_DEFAULTS` and forgotten here would be a card option
 * with no switch, which the tests catch by comparing the two lists.
 */
export const TOGGLES = [
  'group_by_kind',
  'compact',
  'show_server_summary',
  'show_icon',
  'show_state',
  'show_link',
  'show_power',
  'confirm_stop',
  'show_problem',
  'show_update',
  'hide_unavailable',
] as const satisfies readonly (keyof typeof CARD_DEFAULTS)[];

/**
 * Check a config and fill in what it leaves out.
 *
 * Throws on anything the card cannot render, with a message naming the value —
 * Lovelace shows it in place of the card, so it is the only chance to explain
 * what went wrong.
 */
export function normalizeConfig(config: MosCardConfig): MosCardConfig {
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
    (!Number.isInteger(config.columns) || config.columns < 1 || config.columns > MAX_COLUMNS)
  ) {
    throw new Error(`${localize('errors.bad_columns')}: ${config.columns}`);
  }

  return {
    kinds: [...MOS_DEVICE_KINDS],
    ...CARD_DEFAULTS,
    tap_action: { action: 'more-info' },
    ...config,
  };
}

/** The filter's list form as one editable line. */
export function patternsToText(value: string | readonly string[] | undefined): string {
  if (value === undefined) {
    return '';
  }

  return (typeof value === 'string' ? [value] : value).join(', ');
}

/** One editable line back to a list, dropping blanks and stray whitespace. */
export function textToPatterns(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

/**
 * The editor's two filter lines folded back into one config key.
 *
 * Returns nothing when both are empty, so an untouched card keeps no `filter`
 * at all rather than an empty object Lovelace would write into the YAML.
 */
export function foldFilter(includeText: unknown, excludeText: unknown): NameFilter | undefined {
  const include = textToPatterns(includeText);
  const exclude = textToPatterns(excludeText);

  if (!include.length && !exclude.length) {
    return undefined;
  }

  return {
    ...(include.length ? { include } : {}),
    ...(exclude.length ? { exclude } : {}),
  };
}
