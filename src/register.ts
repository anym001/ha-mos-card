/**
 * Registering the card's elements and its picker entry, tolerating a second copy.
 *
 * The bundle can reach a page twice: once from the integration, which ships it,
 * and once from a leftover dashboard resource of an older install. Lit's
 * `@customElement` calls `customElements.define` unconditionally, and a second
 * `define` for the same tag throws — which aborts the second bundle halfway
 * through its top level. Whichever copy loads first keeps the tag.
 *
 * The registry and the picker list are parameters so this runs without a DOM.
 */

/** The part of `CustomElementRegistry` registration needs. */
export type ElementRegistry = Pick<CustomElementRegistry, 'get' | 'define'>;

/** One entry in Home Assistant's card picker. */
export interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
}

/** Define `tag` unless some copy already did; true if this call defined it. */
export function defineOnce(registry: ElementRegistry, tag: string, element: CustomElementConstructor): boolean {
  if (registry.get(tag)) {
    return false;
  }
  registry.define(tag, element);
  return true;
}

/** Add `entry` to the picker list unless a card of the same type is listed. */
export function announceCard(list: CustomCardEntry[] | undefined, entry: CustomCardEntry): CustomCardEntry[] {
  const cards = list ?? [];
  if (!cards.some((card) => card.type === entry.type)) {
    cards.push(entry);
  }
  return cards;
}
