/**
 * THROWAWAY PROTOTYPE (TAP-217). Not production code.
 *
 * The guest's device key and its certificate, in IndexedDB on this origin.
 * This is the store a host IP change empties. Wiping it here simulates that.
 */

import { generateSigningKeyPair } from './provenance'
import type { AnyCert } from './certs'

const DB_NAME = 'tapes-proto-passkey-recovery'
const STORE = 'device'

type DeviceRecord = {
  keyPair: CryptoKeyPair
  cert?: AnyCert
  certAddress?: string
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

/** Loads the device record, creating a fresh key on an empty store. */
export async function loadDevice(): Promise<DeviceRecord & { fresh: boolean }> {
  const existing = await run<DeviceRecord | undefined>('readonly', (s) =>
    s.get('self'),
  )
  if (existing) {
    return { ...existing, fresh: false }
  }
  // Non-extractable, like the real guest key.
  const record: DeviceRecord = { keyPair: await generateSigningKeyPair(false) }
  await run('readwrite', (s) => s.put(record, 'self'))
  return { ...record, fresh: true }
}

export async function saveDevice(record: DeviceRecord): Promise<void> {
  await run('readwrite', (s) => s.put(record, 'self'))
}

export function wipeDevice(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    // Another tab holding the DB open would block. Resolve anyway.
    request.onblocked = () => resolve()
  })
}
