/**
 * A second copy of the bundle on the same page — the integration's and a
 * leftover dashboard resource — must not throw or list the card twice.
 */
import { describe, expect, it } from 'vitest';

import { announceCard, defineOnce } from '../src/register';
import type { CustomCardEntry, ElementRegistry } from '../src/register';

/** Behaves like the browser registry: a repeated `define` throws. */
function fakeRegistry(): ElementRegistry {
  const defined = new Map<string, CustomElementConstructor>();
  return {
    get: (tag: string) => defined.get(tag),
    define: (tag: string, element: CustomElementConstructor) => {
      if (defined.has(tag)) {
        throw new Error(`"${tag}" has already been used with this registry`);
      }
      defined.set(tag, element);
    },
  } as ElementRegistry;
}

const first = class {} as unknown as CustomElementConstructor;
const second = class {} as unknown as CustomElementConstructor;

const entry: CustomCardEntry = { type: 'mos-card', name: 'MOS NAS Card', description: 'first' };

describe('defineOnce', () => {
  it('defines a tag nobody has defined yet', () => {
    const registry = fakeRegistry();

    expect(defineOnce(registry, 'mos-card', first)).toBe(true);
    expect(registry.get('mos-card')).toBe(first);
  });

  it('leaves the first copy in place instead of throwing', () => {
    const registry = fakeRegistry();
    defineOnce(registry, 'mos-card', first);

    expect(defineOnce(registry, 'mos-card', second)).toBe(false);
    expect(registry.get('mos-card')).toBe(first);
  });
});

describe('announceCard', () => {
  it('starts the list when Home Assistant has none yet', () => {
    expect(announceCard(undefined, entry)).toEqual([entry]);
  });

  it('lists the card once however often it is announced', () => {
    const cards = announceCard(undefined, entry);

    expect(announceCard(cards, { ...entry, description: 'second' })).toEqual([entry]);
  });

  it('keeps the cards other bundles listed', () => {
    const other: CustomCardEntry = { type: 'other-card', name: 'Other', description: '' };

    expect(announceCard([other], entry)).toEqual([other, entry]);
  });
});
