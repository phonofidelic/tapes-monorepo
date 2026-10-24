import { generateSigningKeyPair } from '@tapes-monorepo/provenance'
import {
  addRecord,
  openProvenanceDatabase,
  readRecord,
} from './provenanceDatabase'

/**
 * This device's Ed25519 key for signing provenance statements. It is generated
 * non-extractable and stored as a CryptoKey in IndexedDB, so the private key
 * never exists as bytes the app can read. Works on the page and in a worker.
 *
 * IndexedDB is scoped to the origin, and a guest's origin includes the host's
 * LAN IP. When that IP changes, the guest starts over with a new key.
 */

const DEVICE_KEY_ID = 'device'

function isKeyPair(value: unknown): value is CryptoKeyPair {
  const pair = value as Partial<CryptoKeyPair> | undefined
  return (
    pair?.privateKey instanceof CryptoKey && pair.publicKey instanceof CryptoKey
  )
}

async function readKeyPair(
  db: IDBDatabase,
): Promise<CryptoKeyPair | undefined> {
  const value = await readRecord(db, DEVICE_KEY_ID)
  if (value === undefined) {
    return undefined
  }
  if (!isKeyPair(value)) {
    throw new Error('The stored device signing key is not a key pair')
  }
  return value
}

async function loadOrCreate(
  factory: IDBFactory | undefined,
): Promise<CryptoKeyPair> {
  const db = await openProvenanceDatabase(factory)
  try {
    const existing = await readKeyPair(db)
    if (existing) {
      return existing
    }
    const created = await generateSigningKeyPair()
    if (await addRecord(db, DEVICE_KEY_ID, created)) {
      return created
    }
    const winner = await readKeyPair(db)
    if (!winner) {
      throw new Error('The device signing key vanished while being created')
    }
    return winner
  } finally {
    db.close()
  }
}

let pending: Promise<CryptoKeyPair> | undefined

/**
 * This device's signing key pair, created on first use. Rejects where the
 * browser lacks Ed25519 in WebCrypto or has no IndexedDB, as in some private
 * windows. A failed load is not cached, so a later call tries again.
 */
export function loadDeviceSigningKey(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<CryptoKeyPair> {
  pending ??= loadOrCreate(factory).catch((error: unknown) => {
    pending = undefined
    throw error
  })
  return pending
}
