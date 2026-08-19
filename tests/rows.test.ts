/**
 * Row logic: tone, order, capping and the pending power buttons.
 *
 * All of this used to sit on the component, where the only way to check it was
 * to render a card against a live Home Assistant. These are the cases that were
 * reasoned about rather than observed when it did.
 */
import { describe, expect, it } from 'vitest';

import { MOS_DEVICE_KINDS } from '../src/devices';
import type { MosDeviceKind } from '../src/devices';
import { TONES, capRows, compareRows, settledPending, toneFor } from '../src/rows';

describe('toneFor', () => {
  it.each(['running', 'on', 'active', 'ol', 'online', 'RUNNING', 'On'])('reads %s as active', (state) => {
    expect(toneFor('docker_container', state)).toBe('active');
  });

  it.each(['paused', 'frozen', 'standby', 'idle', 'sleeping', 'starting'])('reads %s as idle', (state) => {
    expect(toneFor('virtual_machine', state)).toBe('idle');
  });

  it.each(['exited', 'stopped', 'off', 'shut down'])('reads %s as inactive', (state) => {
    expect(toneFor('lxc_container', state)).toBe('inactive');
  });

  it.each(['unavailable', 'unknown', undefined])('reads %o as unknown, before anything else', (state) => {
    expect(toneFor('docker_container', state)).toBe('unknown');
    expect(toneFor('disk', state)).toBe('unknown');
  });

  it.each(['disk', 'storage_pool'] as const)('leaves %s neutral whatever it reports', (kind) => {
    // A disk reporting `active` names its ATA power mode, not good news.
    expect(toneFor(kind, 'active')).toBe('neutral');
    expect(toneFor(kind, 'standby')).toBe('neutral');
    expect(toneFor(kind, '42')).toBe('neutral');
  });

  it('colours the UPS, which has no power switch but does report mains power', () => {
    // `ol` is NUT for "on line". Grouping the UPS with the other switchless
    // kinds is the obvious simplification and the wrong one.
    expect(toneFor('ups', 'ol')).toBe('active');
    expect(toneFor('ups', 'ob')).toBe('inactive');
  });

  it.each([...MOS_DEVICE_KINDS])('always answers with a tone the styles cover, for %s', (kind) => {
    for (const state of ['running', 'weird', 'unknown', '']) {
      expect(TONES).toContain(toneFor(kind, state));
    }
  });
});

describe('compareRows', () => {
  const row = (name: string, kind: MosDeviceKind = 'docker_container', state?: string) => ({ name, kind, state });

  type Row = ReturnType<typeof row>;

  const stateOf = (r: Row) => r.state;

  it('sorts by name when asked for name, whatever the states are', () => {
    const rows = [row('Zulu', 'docker_container', 'running'), row('Alpha', 'docker_container', 'exited')];

    expect([...rows].sort(compareRows('name', stateOf)).map((r) => r.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('sorts by name when the config says nothing', () => {
    const rows = [row('Zulu'), row('Alpha')];

    expect([...rows].sort(compareRows(undefined, stateOf)).map((r) => r.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('puts running first, then idle, then stopped, then unknown', () => {
    const rows = [
      row('d', 'docker_container', 'unavailable'),
      row('c', 'docker_container', 'exited'),
      row('b', 'docker_container', 'paused'),
      row('a', 'docker_container', 'running'),
    ];

    expect([...rows].sort(compareRows('state', stateOf)).map((r) => r.name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to the name inside one state, so the order is stable', () => {
    const rows = [row('Zulu', 'docker_container', 'running'), row('Alpha', 'docker_container', 'running')];

    expect([...rows].sort(compareRows('state', stateOf)).map((r) => r.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('leaves disks alphabetical under state sorting, their tone being neutral', () => {
    const rows = [row('vdb', 'disk', 'standby'), row('vda', 'disk', 'active')];

    expect([...rows].sort(compareRows('state', stateOf)).map((r) => r.name)).toEqual(['vda', 'vdb']);
  });

  it('ranks a running container above a neutral disk', () => {
    const rows = [row('disk', 'disk', 'active'), row('box', 'docker_container', 'running')];

    expect([...rows].sort(compareRows('state', stateOf)).map((r) => r.name)).toEqual(['box', 'disk']);
  });
});

describe('capRows', () => {
  const rows = ['a', 'b', 'c', 'd'];

  it('hides nothing without a cap', () => {
    expect(capRows(rows, undefined, false)).toEqual({ rows, hidden: 0 });
  });

  it('hides nothing when the group is opened', () => {
    expect(capRows(rows, 2, true)).toEqual({ rows, hidden: 0 });
  });

  it('hides nothing when there are fewer rows than the cap', () => {
    expect(capRows(rows, 9, false)).toEqual({ rows, hidden: 0 });
  });

  it('reports no overflow when the count matches the cap exactly', () => {
    expect(capRows(rows, 4, false)).toEqual({ rows, hidden: 0 });
  });

  it('keeps the top of the order and counts the rest', () => {
    expect(capRows(rows, 2, false)).toEqual({ rows: ['a', 'b'], hidden: 2 });
  });

  it('keeps the top of a state-sorted order, the cap being applied after sorting', () => {
    const sorted = [
      { name: 'up', kind: 'docker_container' as const, state: 'running' },
      { name: 'down', kind: 'docker_container' as const, state: 'exited' },
    ].sort(compareRows('state', (r) => r.state));

    expect(capRows(sorted, 1, false).rows.map((r) => r.name)).toEqual(['up']);
  });

  it('returns a copy, so a caller cannot sort the stored rows by accident', () => {
    const capped = capRows(rows, undefined, false);

    capped.rows.push('e');
    expect(rows).toHaveLength(4);
  });
});

describe('settledPending', () => {
  const states: Record<string, string> = { 'switch.a': 'on', 'switch.b': 'off' };
  const stateOf = (id: string) => states[id];

  it('reports nothing while every switch still reads as it did', () => {
    expect(settledPending(new Map([['switch.a', 'on']]), stateOf)).toEqual([]);
  });

  it('reports a switch that has flipped', () => {
    expect(settledPending(new Map([['switch.a', 'off']]), stateOf)).toEqual(['switch.a']);
  });

  it('treats a switch that has gone away as answered, rather than spinning to the timeout', () => {
    expect(settledPending(new Map([['switch.gone', 'on']]), stateOf)).toEqual(['switch.gone']);
  });

  it('treats a press on an entity that had no state as answered once it gets one', () => {
    expect(settledPending(new Map([['switch.a', '']]), stateOf)).toEqual(['switch.a']);
    expect(settledPending(new Map([['switch.gone', '']]), stateOf)).toEqual([]);
  });

  it('answers each switch on its own', () => {
    const pending = new Map([
      ['switch.a', 'on'],
      ['switch.b', 'on'],
    ]);

    expect(settledPending(pending, stateOf)).toEqual(['switch.b']);
  });

  it('reports nothing for an empty wait', () => {
    expect(settledPending(new Map(), stateOf)).toEqual([]);
  });
});
