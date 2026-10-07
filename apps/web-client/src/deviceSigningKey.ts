import { generateSigningKeyPair } from '@tapes-monorepo/provenance'

/**
 * This device's Ed25519 key for signing provenance statements. It is generated
 * non-extractable and stored as a CryptoKey in IndexedDB, so the private key
 * never exists as bytes the app can read. Works on the page and in a worker.
 *
 * IndexedDB is scoped to the origin, and a guest's origin includes the host's
 * LAN IP. When that IP changes, the guest starts over with a new key.
 */

const DB_NAME = 'tapes-provenance'
const STORE_NAME = 'keys'
const DEVICE_KEY_ID = 'device'

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE_NAME)
  }
  return settle(request)
}

function isKeyPair(value: unknown): value is CryptoKeyPair {
  const pair = value as Partial<CryptoKeyPair> | undefined
  return (
    pair?.privateKey instanceof CryptoKey && pair.publicKey instanceof CryptoKey
  )
}

async function readKeyPair(
  db: IDBDatabase,
): Promise<CryptoKeyPair | undefined> {
  const store = db.transaction(STORE_NAME).objectStore(STORE_NAME)
  const value: unknown = await settle(store.get(DEVICE_KEY_ID))
  if (value === undefined) {
    return undefined
  }
  if (!isKeyPair(value)) {
    throw new Error('The stored device signing key is not a key pair')
  }
  return value
}

/**
 * Stores the key pair unless one is already there. `add` rather than `put`, so
 * that when two tabs race to create a key, the loser fails instead of
 * overwriting the key the winner may already have used.
 */
async function addKeyPair(
  db: IDBDatabase,
  keyPair: CryptoKeyPair,
): Promise<boolean> {
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const request = transaction
    .objectStore(STORE_NAME)
    .add(keyPair, DEVICE_KEY_ID)
  // Without this the failed add also aborts the transaction, which reports the
  // same error a second time.
  request.onerror = (event) => event.preventDefault()
  try {
    await settle(request)
    return true
  } catch (error) {
    if ((error as Error | null)?.name === 'ConstraintError') {
      return false
    }
    throw error
  }
}

async function loadOrCreate(
  factory: IDBFactory | undefined,
): Promise<CryptoKeyPair> {
  if (!factory) {
    throw new Error('Cannot store a device signing key: no IndexedDB')
  }
  const db = await openDatabase(factory)
  try {
    const existing = await readKeyPair(db)
    if (existing) {
      return existing
    }
    const created = await generateSigningKeyPair()
    if (await addKeyPair(db, created)) {
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
