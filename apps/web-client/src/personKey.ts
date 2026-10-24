import {
  createDeviceCertificate,
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
  type DeviceCertificate,
  type Signed,
} from '@tapes-monorepo/provenance'
import {
  addRecord,
  openProvenanceDatabase,
  putRecord,
  readRecord,
} from './provenanceDatabase'

/**
 * The person key on this guest, with the certificate it signed for this
 * device's key. Created on the guest's first join and kept in IndexedDB next
 * to the device key.
 *
 * Unlike the device key, the person key is extractable. Its seed has to be read
 * to make the passphrase backup, and a backup can be made after creation.
 */

const PERSON_KEY_ID = 'person'

export type PersonIdentity = {
  keyPair: CryptoKeyPair
  publicKey: string
  certificate: Signed<DeviceCertificate>
  /** The certificate's statement address, as claims name it. */
  certificateAddress: string
  /** When a backup last unlocked with its passphrase on this device. */
  backedUpAt?: string
  /** When the host this guest is served by added the person to its roster. */
  joinedAt?: string
}

type StoredIdentity = {
  keyPair: CryptoKeyPair
  certificate: Signed<DeviceCertificate>
  backedUpAt?: string
  joinedAt?: string
}

function isStoredIdentity(value: unknown): value is StoredIdentity {
  const stored = value as Partial<StoredIdentity> | undefined
  return (
    stored?.keyPair?.privateKey instanceof CryptoKey &&
    stored.keyPair.publicKey instanceof CryptoKey &&
    typeof stored.certificate?.signature === 'string'
  )
}

async function readStored(
  db: IDBDatabase,
): Promise<StoredIdentity | undefined> {
  const value = await readRecord(db, PERSON_KEY_ID)
  if (value === undefined) {
    return undefined
  }
  if (!isStoredIdentity(value)) {
    throw new Error('The stored person key is not a key pair and certificate')
  }
  return value
}

async function toIdentity(stored: StoredIdentity): Promise<PersonIdentity> {
  return {
    ...stored,
    publicKey: await exportPublicKey(stored.keyPair.publicKey),
    certificateAddress: await statementAddress(stored.certificate),
  }
}

async function withDatabase<T>(
  factory: IDBFactory | undefined,
  run: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  const db = await openProvenanceDatabase(factory)
  try {
    return await run(db)
  } finally {
    db.close()
  }
}

/** The person key on this guest, or undefined before the first join. */
export function loadPersonIdentity(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<PersonIdentity | undefined> {
  return withDatabase(factory, async (db) => {
    const stored = await readStored(db)
    return stored && toIdentity(stored)
  })
}

/**
 * Makes a person key and certifies the device key with it, unless this guest
 * already has one. Returns whichever is stored.
 */
export function createPersonIdentity(
  device: { keyPair: CryptoKeyPair; label: string },
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<PersonIdentity> {
  return withDatabase(factory, async (db) => {
    const existing = await readStored(db)
    if (existing) {
      return toIdentity(existing)
    }
    const keyPair = await generateSigningKeyPair(true)
    const certificate = await createDeviceCertificate(
      {
        deviceKey: await exportPublicKey(device.keyPair.publicKey),
        deviceLabel: device.label,
      },
      keyPair,
    )
    const created: StoredIdentity = { keyPair, certificate }
    if (await addRecord(db, PERSON_KEY_ID, created)) {
      return toIdentity(created)
    }
    const winner = await readStored(db)
    if (!winner) {
      throw new Error('The person key vanished while being created')
    }
    return toIdentity(winner)
  })
}

/** Notes that a backup of the stored person key unlocked with its passphrase. */
export function markPersonKeyBackedUp(
  publicKey: string,
  at: Date,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<void> {
  return updateStored(
    publicKey,
    { backedUpAt: at.toISOString() },
    'The backup is for a different person key',
    factory,
  )
}

/**
 * Notes that the host added the stored person key to its roster. Storage is
 * per origin, and a guest's origin is its host, so one time covers it.
 */
export function markPersonKeyJoined(
  publicKey: string,
  at: Date,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<void> {
  return updateStored(
    publicKey,
    { joinedAt: at.toISOString() },
    'The join was for a different person key',
    factory,
  )
}

function updateStored(
  publicKey: string,
  fields: Partial<Pick<StoredIdentity, 'backedUpAt' | 'joinedAt'>>,
  mismatch: string,
  factory: IDBFactory | undefined,
): Promise<void> {
  return withDatabase(factory, async (db) => {
    const stored = await readStored(db)
    if (
      !stored ||
      (await exportPublicKey(stored.keyPair.publicKey)) !== publicKey
    ) {
      throw new Error(mismatch)
    }
    await putRecord(db, PERSON_KEY_ID, { ...stored, ...fields })
  })
}
