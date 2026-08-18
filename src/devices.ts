/**
 * Device discovery for the MOS NAS integration.
 *
 * Everything this card renders comes out of the Home Assistant **device
 * registry**, filtered on `model_id`. That is a deliberate, documented contract
 * on the integration side — see `docs/development/ARCHITECTURE.md` ("Base
 * Entity") and the decision log entry _Container Devices Carry Their Kind in
 * `model_id`_ in `docs/development/DECISIONS.md` in the ha-mos repository.
 *
 * Two things follow from anchoring here rather than anywhere else:
 *
 *  - `model_id` is machine-readable by contract, where a device's `identifiers`
 *    carry an internal format the integration reserves the right to change and
 *    the display name belongs to the user. Matching either of those would break
 *    on a rename or a refactor; matching `model_id` does not.
 *  - The integration adds and removes these devices at runtime through
 *    `async_setup_dynamic_entities`, so following the registry gets lifecycle
 *    for free. A deleted container disappears from the card, a new one shows
 *    up, and a container behind a failing endpoint keeps its device and merely
 *    reports its entities unavailable. There is nothing to refresh by hand.
 */

import { createCollection } from 'home-assistant-js-websocket';
import type { Connection, UnsubscribeFunc } from 'home-assistant-js-websocket';

/**
 * The `model_id` values the integration writes onto its container devices.
 *
 * These are a released, public contract: the integration treats them as fixed
 * once shipped, and this card matches on them verbatim. The MOS *server* device
 * deliberately carries no `model_id` at all — it is identified instead by being
 * the `via_device_id` target of the devices below.
 */
export const MOS_DEVICE_KINDS = [
  'docker_container',
  'lxc_container',
  'virtual_machine',
  'disk',
  'storage_pool',
  'ups',
] as const;

export type MosDeviceKind = (typeof MOS_DEVICE_KINDS)[number];

const MOS_DEVICE_KIND_SET: ReadonlySet<string> = new Set(MOS_DEVICE_KINDS);

export function isMosDeviceKind(value: unknown): value is MosDeviceKind {
  return typeof value === 'string' && MOS_DEVICE_KIND_SET.has(value);
}

/**
 * Per-kind rendering facts.
 *
 * `stateTranslationKey` names the entity that carries the row's headline value.
 * For the three guest kinds that entity also carries the MOS template icon as
 * its `entity_picture`, and the Docker one additionally carries `web_ui_url`,
 * `repo`, `network_mode` and the image metadata as attributes — which is why a
 * whole row can be built from a single entity.
 *
 * `stateKeySuffix` is the same entity's `key` on the integration side, used only
 * as a fallback when the entity registry does not hand us a `translation_key`
 * (older Home Assistant cores omit it from the websocket payload).
 */
interface KindInfo {
  /** Fallback icon, used when the state entity has no `entity_picture`. */
  readonly icon: string;
  readonly stateTranslationKey: string;
  readonly stateKeySuffix: string;
  /** Whether devices of this kind carry a start/stop switch. */
  readonly hasPower: boolean;
}

export const KIND_INFO: Readonly<Record<MosDeviceKind, KindInfo>> = {
  docker_container: {
    icon: 'mdi:docker',
    stateTranslationKey: 'docker_state',
    stateKeySuffix: 'state',
    hasPower: true,
  },
  lxc_container: {
    icon: 'mdi:linux',
    stateTranslationKey: 'lxc_state',
    stateKeySuffix: 'state',
    hasPower: true,
  },
  virtual_machine: {
    icon: 'mdi:server',
    stateTranslationKey: 'vm_state',
    stateKeySuffix: 'state',
    hasPower: true,
  },
  disk: {
    icon: 'mdi:harddisk',
    stateTranslationKey: 'disk_power_status',
    stateKeySuffix: 'power_status',
    hasPower: false,
  },
  storage_pool: {
    icon: 'mdi:database',
    stateTranslationKey: 'pool_usage',
    stateKeySuffix: 'usage',
    hasPower: false,
  },
  ups: {
    icon: 'mdi:power-plug',
    stateTranslationKey: 'ups_status',
    stateKeySuffix: 'ups_status',
    hasPower: false,
  },
};

export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  model: string | null;
  model_id: string | null;
  manufacturer: string | null;
  via_device_id: string | null;
  configuration_url: string | null;
  area_id: string | null;
  disabled_by: string | null;
  identifiers: Array<[string, string]>;
  config_entries: string[];
}

export interface EntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  platform: string;
  unique_id?: string;
  translation_key?: string | null;
  disabled_by: string | null;
  hidden_by: string | null;
  entity_category: string | null;
}

/**
 * Registry collections.
 *
 * `createCollection` caches per websocket connection, so several MOS cards on
 * one dashboard share a single fetch and a single event subscription. The
 * registry-updated events are what make the card follow container churn without
 * polling.
 */
export const subscribeDeviceRegistry = (
  conn: Connection,
  onChange: (devices: DeviceRegistryEntry[]) => void,
): UnsubscribeFunc =>
  createCollection<DeviceRegistryEntry[]>(
    '_mosDeviceRegistry',
    (connection) => connection.sendMessagePromise<DeviceRegistryEntry[]>({ type: 'config/device_registry/list' }),
    (connection, store) =>
      connection.subscribeEvents(
        () =>
          connection
            .sendMessagePromise<DeviceRegistryEntry[]>({ type: 'config/device_registry/list' })
            .then((devices) => store.setState(devices, true)),
        'device_registry_updated',
      ),
    conn,
    onChange,
  );

export const subscribeEntityRegistry = (
  conn: Connection,
  onChange: (entities: EntityRegistryEntry[]) => void,
): UnsubscribeFunc =>
  createCollection<EntityRegistryEntry[]>(
    '_mosEntityRegistry',
    (connection) => connection.sendMessagePromise<EntityRegistryEntry[]>({ type: 'config/entity_registry/list' }),
    (connection, store) =>
      connection.subscribeEvents(
        () =>
          connection
            .sendMessagePromise<EntityRegistryEntry[]>({ type: 'config/entity_registry/list' })
            .then((entities) => store.setState(entities, true)),
        'entity_registry_updated',
      ),
    conn,
    onChange,
  );

/**
 * The icons an integration declares in its `icons.json`, as the frontend serves
 * them: domain, then `translation_key`, then a default and optional per-state
 * overrides.
 */
export interface IntegrationIcons {
  [domain: string]: Record<string, { default?: string; state?: Record<string, string> }>;
}

/**
 * Fetch the integration's own entity icons.
 *
 * Since ha-mos moved its icons into `icons.json`, they no longer arrive as the
 * `icon` attribute on a state: Home Assistant resolves them in the frontend
 * from the entity's `translation_key`. A card that wants to show what the
 * integration intends therefore has to ask for them, which is what this does —
 * the same websocket command the frontend itself uses.
 *
 * One request per card, answered from Home Assistant's own cache, and the
 * result never changes for a given integration version.
 */
export const fetchIntegrationIcons = (conn: Connection, integration: string): Promise<IntegrationIcons> =>
  conn
    .sendMessagePromise<{ resources: Record<string, IntegrationIcons> }>({
      type: 'frontend/get_icons',
      category: 'entity',
      integration,
    })
    .then((result) => result.resources?.[integration] ?? {});

/**
 * The icon `icons.json` declares for an entity, if it declares one.
 *
 * A `translation_key` is what ties the entity to its entry, so an entity
 * without one — or a kind the integration gives no icon, which is the case for
 * the Docker, LXC and VM state sensors that carry a picture instead — resolves
 * to nothing and leaves the caller to fall back.
 */
export function declaredIcon(
  icons: IntegrationIcons | undefined,
  entity: EntityRegistryEntry | undefined,
  state: string | undefined,
): string | undefined {
  if (!icons || !entity?.translation_key) {
    return undefined;
  }

  const domain = entity.entity_id.split('.')[0];
  const declared = icons[domain]?.[entity.translation_key];

  if (!declared) {
    return undefined;
  }

  return (state !== undefined ? declared.state?.[state] : undefined) ?? declared.default;
}

/**
 * The MOS server devices: the `via_device_id` targets of the container devices.
 *
 * Derived rather than matched, precisely because the server device carries no
 * `model_id` of its own to match on. Anything that is the parent of a device
 * with a MOS kind is by definition a MOS server.
 */
export function findServerDevices(devices: DeviceRegistryEntry[]): DeviceRegistryEntry[] {
  const byId = new Map(devices.map((device) => [device.id, device]));
  const serverIds = new Set<string>();

  for (const device of devices) {
    if (isMosDeviceKind(device.model_id) && device.via_device_id) {
      serverIds.add(device.via_device_id);
    }
  }

  return [...serverIds]
    .map((id) => byId.get(id))
    .filter((device): device is DeviceRegistryEntry => device !== undefined);
}

/**
 * Every container device of one of the requested kinds, optionally scoped to a
 * single server.
 *
 * Disabled devices are left out: the user disabled them, and the integration
 * will not be producing states for them either.
 */
export function selectMosDevices(
  devices: DeviceRegistryEntry[],
  kinds: readonly MosDeviceKind[],
  serverId?: string,
): DeviceRegistryEntry[] {
  const wanted = new Set<string>(kinds);

  return devices.filter(
    (device) =>
      device.disabled_by === null &&
      isMosDeviceKind(device.model_id) &&
      wanted.has(device.model_id) &&
      (serverId === undefined || device.via_device_id === serverId),
  );
}

/** Index the entity registry by device, dropping entities that cannot render. */
export function entitiesByDevice(entities: EntityRegistryEntry[]): Map<string, EntityRegistryEntry[]> {
  const index = new Map<string, EntityRegistryEntry[]>();

  for (const entity of entities) {
    if (!entity.device_id || entity.disabled_by !== null || entity.hidden_by !== null) {
      continue;
    }
    const existing = index.get(entity.device_id);
    if (existing) {
      existing.push(entity);
    } else {
      index.set(entity.device_id, [entity]);
    }
  }

  return index;
}

/**
 * Pick the entity whose state is the headline value for a device of this kind.
 *
 * `translation_key` first: it is the integration's own name for the entity and
 * survives renames and entity_id changes. The `unique_id` suffix is a fallback
 * for cores that do not serialize `translation_key` into the registry payload,
 * and the first plain sensor is the last resort so a row still renders if the
 * integration grows a kind this card has not been taught about.
 */
export function findStateEntity(
  entities: readonly EntityRegistryEntry[],
  kind: MosDeviceKind,
): EntityRegistryEntry | undefined {
  const info = KIND_INFO[kind];

  return (
    entities.find((entity) => entity.translation_key === info.stateTranslationKey) ??
    entities.find(
      (entity) => entity.entity_id.startsWith('sensor.') && entity.unique_id?.endsWith(`_${info.stateKeySuffix}`),
    ) ??
    entities.find((entity) => entity.entity_id.startsWith('sensor.'))
  );
}

/**
 * The start/stop switch for a guest, if it has one.
 *
 * Each of the three guest kinds contributes exactly one switch to its device,
 * so matching the domain is enough and does not depend on the switch's name.
 */
export function findPowerEntity(
  entities: readonly EntityRegistryEntry[],
  kind: MosDeviceKind,
): EntityRegistryEntry | undefined {
  if (!KIND_INFO[kind].hasPower) {
    return undefined;
  }

  return entities.find((entity) => entity.entity_id.startsWith('switch.'));
}

/**
 * The display name for a device row.
 *
 * The user's own name wins, then the registry name. The integration prefixes
 * container device names with the server and the kind ("Sirius Docker
 * pushbits") so they stay unique across servers; inside a card that is already
 * grouped by server and kind that prefix is noise, so it is trimmed off for
 * display only — never used for matching.
 */
export function deviceDisplayName(device: DeviceRegistryEntry, serverName?: string): string {
  const name = device.name_by_user || device.name || device.id;

  if (device.name_by_user) {
    return name;
  }

  let trimmed = name;

  if (serverName && trimmed.toLowerCase().startsWith(`${serverName.toLowerCase()} `)) {
    trimmed = trimmed.slice(serverName.length + 1);
  }

  for (const prefix of ['Docker ', 'LXC ', 'VM ', 'Disk ', 'Pool ', 'UPS ']) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  return trimmed;
}

/** Whether a state string means "Home Assistant has no reading for this". */
export function isUnavailableState(state: string | undefined): boolean {
  return state === undefined || state === 'unavailable' || state === 'unknown';
}
