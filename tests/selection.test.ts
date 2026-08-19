/**
 * The `model_id` contract, exercised.
 *
 * These are the tests that would catch someone quietly switching the card back
 * to matching on names or identifiers — the one change the integration's own
 * decision log forbids, and the one this repository's AGENTS.md calls out
 * first.
 */
import { describe, expect, it } from 'vitest';

import {
  MOS_DEVICE_KINDS,
  entitiesByDevice,
  findServerDevices,
  isMosDeviceKind,
  isUnavailableState,
  selectMosDevices,
} from '../src/devices';
import { DISK, DOCKER, DOCKER_ENTITIES, LXC, POOL, SERVER, SERVER_TWO, device, entity } from './fixtures';

const ALL = [SERVER, SERVER_TWO, DOCKER, LXC, DISK, POOL];

describe('isMosDeviceKind', () => {
  it.each([...MOS_DEVICE_KINDS])('accepts the released kind %s', (kind) => {
    expect(isMosDeviceKind(kind)).toBe(true);
  });

  it.each([null, undefined, 42, '', 'container', 'DOCKER_CONTAINER'])('rejects %o', (value) => {
    expect(isMosDeviceKind(value)).toBe(false);
  });
});

describe('findServerDevices', () => {
  it('derives the server from being a MOS device parent, not from a model_id', () => {
    expect(SERVER.model_id).toBeNull();
    expect(findServerDevices(ALL)).toEqual([SERVER]);
  });

  it('ignores a parent whose children are not MOS devices', () => {
    const foreign = device({ id: 'other', name: 'A hub' });
    const child = device({ id: 'child', model_id: 'light', via_device_id: 'other' });

    expect(findServerDevices([foreign, child])).toEqual([]);
  });

  it('returns each server once however many devices hang off it', () => {
    const second = device({ id: 'd2', model_id: 'disk', via_device_id: 'srv1' });

    expect(findServerDevices([...ALL, second])).toHaveLength(1);
  });

  it('leaves out a parent that is not itself in the list', () => {
    const orphan = device({ id: 'orphan', model_id: 'disk', via_device_id: 'gone' });

    expect(findServerDevices([orphan])).toEqual([]);
  });
});

describe('selectMosDevices', () => {
  it('takes only the requested kinds', () => {
    expect(selectMosDevices(ALL, ['docker_container']).map((d) => d.id)).toEqual(['dev-docker']);
  });

  it('never returns the server, which carries no model_id', () => {
    expect(selectMosDevices(ALL, [...MOS_DEVICE_KINDS]).map((d) => d.id)).not.toContain('srv1');
  });

  it('scopes to one server by via_device_id', () => {
    const elsewhere = device({ id: 'far', model_id: 'docker_container', via_device_id: 'srv2' });

    expect(selectMosDevices([...ALL, elsewhere], ['docker_container'], 'srv2').map((d) => d.id)).toEqual(['far']);
  });

  it('leaves out devices the user disabled', () => {
    const off = device({ id: 'off', model_id: 'disk', via_device_id: 'srv1', disabled_by: 'user' });

    expect(selectMosDevices([...ALL, off], ['disk']).map((d) => d.id)).toEqual(['dev-disk']);
  });

  it('ignores names and identifiers entirely', () => {
    const misnamed = device({
      id: 'weird',
      name: 'not a container at all',
      name_by_user: 'nor this',
      identifiers: [['mos', 'something_internal']],
      model_id: 'docker_container',
      via_device_id: 'srv1',
    });

    expect(selectMosDevices([...ALL, misnamed], ['docker_container']).map((d) => d.id)).toContain('weird');
  });
});

describe('entitiesByDevice', () => {
  it('groups by device and drops what cannot render', () => {
    const index = entitiesByDevice([
      ...DOCKER_ENTITIES,
      entity({ entity_id: 'sensor.orphan' }),
      entity({ entity_id: 'sensor.off', device_id: 'dev-docker', disabled_by: 'integration' }),
      entity({ entity_id: 'sensor.hidden', device_id: 'dev-docker', hidden_by: 'user' }),
    ]);

    expect(index.get('dev-docker')).toHaveLength(DOCKER_ENTITIES.length);
    expect(index.has(null as unknown as string)).toBe(false);
  });

  it('keeps diagnostic entities, which is where the badges live', () => {
    const index = entitiesByDevice(DOCKER_ENTITIES);

    expect(index.get('dev-docker')?.map((e) => e.entity_id)).toContain(
      'binary_sensor.pluto_docker_pushbits_update_available',
    );
  });
});

describe('isUnavailableState', () => {
  it.each(['unavailable', 'unknown', undefined])('treats %o as no reading', (state) => {
    expect(isUnavailableState(state)).toBe(true);
  });

  it.each(['running', 'exited', 'off', ''])('treats %o as a reading', (state) => {
    expect(isUnavailableState(state)).toBe(false);
  });
});
