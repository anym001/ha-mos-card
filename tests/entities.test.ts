/**
 * Entity resolution: which entity on a device carries which meaning.
 *
 * Each lookup has two steps and the fallback is the interesting one — a Home
 * Assistant core that does not serialize `translation_key` into the registry
 * payload leaves only the `unique_id` suffix to go on, and a card that only
 * ever ran against a core that does would never notice it broke.
 */
import { describe, expect, it } from 'vitest';

import {
  KIND_INFO,
  declaredIcon,
  deviceDisplayName,
  findMetricEntity,
  findPowerEntity,
  findProblemCandidates,
  findStateEntity,
  findUpdateEntity,
  metricsForMode,
  resolveMetrics,
} from '../src/devices';
import { COMPOSE, COMPOSE_ENTITIES, DISK, DOCKER, DOCKER_ENTITIES, SERVER, entity } from './fixtures';

/**
 * The same entities, as a core that omits translation keys would send them.
 *
 * Reversed on purpose. `findStateEntity` ends in a last-resort "first sensor
 * on the device", and in registry order that happens to be the state sensor —
 * so a test built on that order passes even with the `unique_id` step deleted,
 * which is not a test of the `unique_id` step at all.
 */
const withoutTranslationKeys = DOCKER_ENTITIES.map((e) => ({ ...e, translation_key: undefined })).reverse();

describe('findStateEntity', () => {
  it('prefers the translation key', () => {
    expect(findStateEntity(DOCKER_ENTITIES, 'docker_container')?.entity_id).toBe('sensor.pluto_docker_pushbits_state');
  });

  it('falls back to the unique_id suffix', () => {
    expect(findStateEntity(withoutTranslationKeys, 'docker_container')?.entity_id).toBe(
      'sensor.pluto_docker_pushbits_state',
    );
  });

  it('reaches the last resort when neither key is there, so a row still renders', () => {
    const onlyCpu = withoutTranslationKeys.filter((e) => e.entity_id.endsWith('_cpu_usage'));

    expect(findStateEntity(onlyCpu, 'docker_container')?.entity_id).toBe('sensor.pluto_docker_pushbits_cpu_usage');
  });

  it('finds nothing when the device has no sensor at all', () => {
    expect(findStateEntity([entity({ entity_id: 'switch.x' })], 'docker_container')).toBeUndefined();
  });
});

describe('findPowerEntity', () => {
  it('matches on the domain, so a renamed switch still works', () => {
    expect(findPowerEntity(DOCKER_ENTITIES, 'docker_container')?.entity_id).toBe('switch.pluto_docker_pushbits_power');
  });

  it.each(['disk', 'storage_pool', 'ups'] as const)('returns nothing for %s, which has no switch', (kind) => {
    expect(KIND_INFO[kind].hasPower).toBe(false);
    expect(findPowerEntity(DOCKER_ENTITIES, kind)).toBeUndefined();
  });
});

describe('findUpdateEntity', () => {
  it('finds the update sensor by translation key', () => {
    expect(findUpdateEntity(DOCKER_ENTITIES, 'docker_container')?.entity_id).toBe(
      'binary_sensor.pluto_docker_pushbits_update_available',
    );
  });

  it('falls back to the unique_id suffix', () => {
    expect(findUpdateEntity(withoutTranslationKeys, 'docker_container')?.entity_id).toBe(
      'binary_sensor.pluto_docker_pushbits_update_available',
    );
  });

  it('makes no last-resort guess: a wrong badge is worse than none', () => {
    const noUpdate = DOCKER_ENTITIES.filter((e) => !e.entity_id.includes('update'));

    expect(
      findUpdateEntity(
        noUpdate.map((e) => ({ ...e, translation_key: undefined })),
        'docker_container',
      ),
    ).toBeUndefined();
  });

  it.each(['lxc_container', 'virtual_machine', 'disk'] as const)('returns nothing for %s', (kind) => {
    expect(findUpdateEntity(DOCKER_ENTITIES, kind)).toBeUndefined();
  });
});

describe('metricsForMode and findMetricEntity', () => {
  it('resolves cpu and memory for a guest under auto', () => {
    const found = metricsForMode('docker_container', 'auto').map(
      (metric) => findMetricEntity(DOCKER_ENTITIES, metric)?.entity_id,
    );

    expect(found).toEqual(['sensor.pluto_docker_pushbits_cpu_usage', 'sensor.pluto_docker_pushbits_memory_usage']);
  });

  it('resolves nothing at all under none', () => {
    expect(metricsForMode('docker_container', 'none')).toEqual([]);
  });

  it('gives a disk its temperature under auto and nothing under cpu', () => {
    expect(metricsForMode('disk', 'auto')[0].translationKey).toBe('disk_temperature');
    expect(metricsForMode('disk', 'cpu')).toEqual([]);
    expect(metricsForMode('storage_pool', 'memory')).toEqual([]);
  });

  it('falls back to the unique_id suffix', () => {
    const metric = metricsForMode('docker_container', 'cpu')[0];

    expect(findMetricEntity(withoutTranslationKeys, metric)?.entity_id).toBe('sensor.pluto_docker_pushbits_cpu_usage');
  });

  it('makes no last-resort guess either', () => {
    expect(
      findMetricEntity([entity({ entity_id: 'sensor.something_else' })], metricsForMode('disk', 'auto')[0]),
    ).toBeUndefined();
  });
});

/**
 * The Compose stack, which is the one kind whose measurement is a pair.
 *
 * A stack reports no CPU and no memory at all — MOS measures those one
 * container at a time — so `auto` resolves to how many of its containers are up
 * over how many it has, and the two explicit modes resolve to nothing.
 */
describe('Compose stacks', () => {
  it('finds the state sensor, the switch and the update sensor', () => {
    expect(findStateEntity(COMPOSE_ENTITIES, 'compose_stack')?.entity_id).toBe('sensor.pluto_compose_media_state');
    expect(findPowerEntity(COMPOSE_ENTITIES, 'compose_stack')?.entity_id).toBe('switch.pluto_compose_media_power');
    expect(findUpdateEntity(COMPOSE_ENTITIES, 'compose_stack')?.entity_id).toBe(
      'binary_sensor.pluto_compose_media_update_available',
    );
  });

  it('falls back to the unique_id suffix for all three', () => {
    const noKeys = COMPOSE_ENTITIES.map((e) => ({ ...e, translation_key: undefined })).reverse();

    expect(findStateEntity(noKeys, 'compose_stack')?.entity_id).toBe('sensor.pluto_compose_media_state');
    expect(findUpdateEntity(noKeys, 'compose_stack')?.entity_id).toBe(
      'binary_sensor.pluto_compose_media_update_available',
    );
  });

  it('resolves the running count over the container count under auto', () => {
    const [metric] = resolveMetrics(COMPOSE_ENTITIES, metricsForMode('compose_stack', 'auto'));

    expect(metric.entity.entity_id).toBe('sensor.pluto_compose_media_running_containers');
    expect(metric.over?.entity_id).toBe('sensor.pluto_compose_media_containers');
  });

  it('keeps the count when the total is missing, rather than dropping both', () => {
    const noTotal = COMPOSE_ENTITIES.filter((e) => e.entity_id !== 'sensor.pluto_compose_media_containers');
    const [metric] = resolveMetrics(noTotal, metricsForMode('compose_stack', 'auto'));

    expect(metric.entity.entity_id).toBe('sensor.pluto_compose_media_running_containers');
    expect(metric.over).toBeUndefined();
  });

  it('has no CPU or memory to ask for', () => {
    expect(metricsForMode('compose_stack', 'cpu')).toEqual([]);
    expect(metricsForMode('compose_stack', 'memory')).toEqual([]);
  });
});

describe('resolveMetrics', () => {
  it('drops a metric the device has no entity for', () => {
    const noMemory = DOCKER_ENTITIES.filter((e) => !e.entity_id.endsWith('_memory_usage'));

    expect(resolveMetrics(noMemory, metricsForMode('docker_container', 'auto')).map((m) => m.entity.entity_id)).toEqual(
      ['sensor.pluto_docker_pushbits_cpu_usage'],
    );
  });

  it('leaves a metric without a declared total unpaired', () => {
    const [cpu] = resolveMetrics(DOCKER_ENTITIES, metricsForMode('docker_container', 'cpu'));

    expect(cpu.over).toBeUndefined();
  });
});

describe('findProblemCandidates', () => {
  it('offers every binary sensor and nothing else, the device class being on the state', () => {
    expect(findProblemCandidates(DOCKER_ENTITIES).map((e) => e.entity_id)).toEqual([
      'binary_sensor.pluto_docker_pushbits_update_available',
      'binary_sensor.pluto_docker_pushbits_health',
    ]);
  });
});

describe('deviceDisplayName', () => {
  it('trims the server and kind prefix the integration writes', () => {
    expect(deviceDisplayName(DOCKER, 'Pluto')).toBe('pushbits');
  });

  it('trims the Compose prefix as well, so a stack reads by its own name', () => {
    expect(deviceDisplayName(COMPOSE, 'Pluto')).toBe('media');
  });

  it('leaves a name the user chose completely alone', () => {
    expect(deviceDisplayName(DISK, 'Pluto')).toBe('Parity');
  });

  it('trims the kind prefix even without a server name', () => {
    expect(deviceDisplayName(DOCKER)).toBe('Pluto Docker pushbits');
  });

  it('matches the server prefix regardless of case', () => {
    expect(deviceDisplayName(DOCKER, 'pluto')).toBe('pushbits');
  });

  it('falls back to the device id when there is no name at all', () => {
    expect(deviceDisplayName(SERVER_WITHOUT_NAME)).toBe('nameless');
  });
});

const SERVER_WITHOUT_NAME = { ...SERVER, id: 'nameless', name: null, name_by_user: null };

describe('declaredIcon', () => {
  const icons = {
    sensor: {
      disk_power_status: { default: 'mdi:harddisk', state: { standby: 'mdi:sleep' } },
      pool_usage: { default: 'mdi:database' },
    },
  };

  it('resolves a per-state icon before the default', () => {
    const e = entity({ entity_id: 'sensor.d', translation_key: 'disk_power_status' });

    expect(declaredIcon(icons, e, 'standby')).toBe('mdi:sleep');
    expect(declaredIcon(icons, e, 'active')).toBe('mdi:harddisk');
  });

  it('resolves nothing without a translation key, which is how a picture wins', () => {
    expect(declaredIcon(icons, entity({ entity_id: 'sensor.d' }), 'active')).toBeUndefined();
  });

  it('resolves nothing when the icons have not arrived yet', () => {
    expect(
      declaredIcon(undefined, entity({ entity_id: 'sensor.d', translation_key: 'pool_usage' }), 'x'),
    ).toBeUndefined();
  });
});
