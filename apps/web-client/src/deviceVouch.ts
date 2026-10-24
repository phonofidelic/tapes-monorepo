import {
  checkDeviceVouch,
  statementAddress,
  type DeviceVouch,
  type Signed,
} from '@tapes-monorepo/provenance'
import {
  openProvenanceDatabase,
  putRecord,
  readRecord,
} from './provenanceDatabase'

/**
 * The host's vouch for this device, on a guest that lost its keys and has no
 * person key. Claims name it in place of a device certificate until the person
 * restores their person key. Kept in IndexedDB next to the device key.
 *
 * Only a vouch the pinned host signed for this device's own key is stored.
 */

const VOUCH_ID = 'vouch'

export type StoredVouch = {
  vouch: Signed<DeviceVouch>
  /** The vouch's statement address, as claims name it. */
  address: string
}

export type VouchRejection =
  | 'bad-vouch'
  /** No host key is pinned, so nothing can be checked against it. */
  | 'no-pinned-host'
  | 'other-host'
  | 'other-device'

export async function loadDeviceVouch(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<StoredVouch | undefined> {
  const db = await openProvenanceDatabase(factory)
  try {
    const value = (await readRecord(db, VOUCH_ID)) as
      Signed<DeviceVouch> | undefined
    if (value === undefined) {
      return undefined
    }
    const check = await checkDeviceVouch(value)
    if (!check.ok) {
      throw new Error('The stored device vouch does not verify')
    }
    return { vouch: check.vouch, address: await statementAddress(check.vouch) }
  } finally {
    db.close()
  }
}

/**
 * Checks a vouch against the pinned host key and this device's key, and stores
 * it if both match. A later vouch replaces an earlier one.
 */
export async function storeDeviceVouch(
  signed: Signed<unknown>,
  expected: { hostKey: string | undefined; deviceKey: string },
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<
  { ok: true; stored: StoredVouch } | { ok: false; problem: VouchRejection }
> {
  const check = await checkDeviceVouch(signed)
  if (!check.ok) {
    return { ok: false, problem: 'bad-vouch' }
  }
  const { payload } = check.vouch
  if (!expected.hostKey) {
    return { ok: false, problem: 'no-pinned-host' }
  }
  if (payload.hostKey !== expected.hostKey) {
    return { ok: false, problem: 'other-host' }
  }
  if (payload.deviceKey !== expected.deviceKey) {
    return { ok: false, problem: 'other-device' }
  }
  const db = await openProvenanceDatabase(factory)
  try {
    await putRecord(db, VOUCH_ID, check.vouch)
  } finally {
    db.close()
  }
  return {
    ok: true,
    stored: {
      vouch: check.vouch,
      address: await statementAddress(check.vouch),
    },
  }
}
