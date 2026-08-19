/**
 * Row-level logic: what colour a row is, what order rows come in, how many of
 * them are shown, and which power buttons are still waiting.
 *
 * All of it takes plain values and returns plain values. It lives here rather
 * than on the component because none of it needs a DOM, a `hass` or a render —
 * and because on the component it could only be checked by driving the card.
 */
import { isUnavailableState } from './devices';
import type { MosDeviceKind, RowSort } from './devices';

/**
 * The colour families a row can be drawn in.
 *
 * Kept to a handful of names rather than a colour per state so the palette
 * stays a theme concern: the CSS maps each tone onto a Home Assistant theme
 * variable, and a state nobody anticipated lands on the neutral one.
 *
 * The order is also the order `sort: state` lists them in, which is why there
 * is one list and not two: what reads as "up" is what sorts to the top.
 */
export const TONES = ['active', 'idle', 'neutral', 'inactive', 'unknown'] as const;

export type Tone = (typeof TONES)[number];

/** States that mean the thing is doing its job. */
const ACTIVE_STATES = new Set(['running', 'on', 'active', 'ol', 'online']);

/** States that mean it exists but is not doing its job yet. */
const IDLE_STATES = new Set(['paused', 'frozen', 'standby', 'idle', 'sleeping', 'starting']);

/**
 * The tone a row of this kind and state is drawn in.
 *
 * Only kinds whose state says something about *running* are coloured. A disk
 * reporting `active` is naming its ATA power mode and a pool reports how full
 * it is — neither is good news or bad news, and colouring them drowns out the
 * containers, which are the reason to look at the card at all.
 */
export function toneFor(kind: MosDeviceKind, state: string | undefined): Tone {
  if (isUnavailableState(state)) {
    return 'unknown';
  }

  // Named kinds rather than "everything without a power switch": the UPS has no
  // switch either, but `ol` means mains power is fine and that is worth the
  // colour. A disk reporting `active` is naming its ATA power mode and a pool
  // reports how full it is — neither is good news or bad news.
  if (kind === 'disk' || kind === 'storage_pool') {
    return 'neutral';
  }

  const value = (state as string).toLowerCase();

  if (ACTIVE_STATES.has(value)) {
    return 'active';
  }

  return IDLE_STATES.has(value) ? 'idle' : 'inactive';
}

/** The minimum a row has to carry to be ordered. */
export interface OrderableRow {
  name: string;
  kind: MosDeviceKind;
}

/**
 * How two rows of the same kind are ordered.
 *
 * `state` ranks by the same tone the row is drawn in, so the sorted order and
 * the colours tell the same story, and falls back to the name so that two rows
 * in the same state keep a stable, readable order.
 */
export function compareRows<T extends OrderableRow>(
  sort: RowSort | undefined,
  stateOf: (row: T) => string | undefined,
): (left: T, right: T) => number {
  return (left, right) => {
    if (sort === 'state') {
      const rank =
        TONES.indexOf(toneFor(left.kind, stateOf(left))) - TONES.indexOf(toneFor(right.kind, stateOf(right)));

      if (rank !== 0) {
        return rank;
      }
    }

    return left.name.localeCompare(right.name);
  };
}

/**
 * The rows a group shows, and how many it is holding back.
 *
 * An absent cap, an opened group, or fewer rows than the cap all mean the same
 * thing: show everything and hide nothing. Only a cap that actually bites
 * reports a count, so the caller can tell "nothing hidden" from "nothing left".
 */
export function capRows<T>(
  rows: readonly T[],
  max: number | undefined,
  expanded: boolean,
): { rows: T[]; hidden: number } {
  if (max === undefined || expanded || rows.length <= max) {
    return { rows: [...rows], hidden: 0 };
  }

  return { rows: rows.slice(0, max), hidden: rows.length - max };
}

/**
 * Which waiting power buttons the incoming states have answered.
 *
 * The recorded value is the state the switch had when the button was pressed,
 * so anything else means the request landed — including a switch that has gone
 * unavailable, which is an answer of a kind and better than spinning until the
 * timeout.
 */
export function settledPending(
  pending: ReadonlyMap<string, string>,
  stateOf: (entityId: string) => string | undefined,
): string[] {
  const settled: string[] = [];

  for (const [entityId, before] of pending) {
    if ((stateOf(entityId) ?? '') !== before) {
      settled.push(entityId);
    }
  }

  return settled;
}

/**
 * The timeouts that end a wait nobody answered.
 *
 * Split from the map of waiting switches because the two fail differently: the
 * map is state Lit has to see change, while these are side effects that have to
 * be cancelled — on an answer, and on the card being torn down, which happens
 * on every dashboard edit. A leaked timeout fires against a detached element.
 */
export class PendingTimers {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly timeoutMs: number) {}

  /** How many waits are still armed. Exposed for tests and assertions. */
  get size(): number {
    return this.timers.size;
  }

  /**
   * Arm a timeout for one switch, replacing any it already had.
   *
   * Replacing rather than stacking: two timeouts for one switch would fire
   * twice, and the second would end a wait the caller had already restarted.
   */
  start(entityId: string, onExpire: (entityId: string) => void): void {
    this.stop(entityId);
    this.timers.set(
      entityId,
      setTimeout(() => {
        this.timers.delete(entityId);
        onExpire(entityId);
      }, this.timeoutMs),
    );
  }

  /** Cancel one wait. Silent when there is none, so callers need not check. */
  stop(entityId: string): void {
    const timer = this.timers.get(entityId);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(entityId);
    }
  }

  /** Cancel everything. The teardown path, and safe to call twice. */
  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }
}
