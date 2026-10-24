/**
 * The IndexedDB store that holds this guest's keys: the device signing key and
 * the person key with its device certificate. Works on the page and in a
 * worker.
 *
 * IndexedDB is scoped to the origin, and a guest's origin includes the host's
 * LAN IP. When that IP changes, the guest starts over with new keys.
 */

const DB_NAME = 'tapes-provenance'
const STORE_NAME = 'keys'

export function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function openProvenanceDatabase(
  factory: IDBFactory | undefined,
): Promise<IDBDatabase> {
  if (!factory) {
    return Promise.reject(new Error('Cannot store signing keys: no IndexedDB'))
  }
  const request = factory.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE_NAME)
  }
  return settle(request)
}

export async function readRecord(
  db: IDBDatabase,
  id: string,
): Promise<unknown> {
  const store = db.transaction(STORE_NAME).objectStore(STORE_NAME)
  return settle(store.get(id))
}

/**
 * Stores the value unless one is already there. `add` rather than `put`, so
 * that when two tabs race to create a key, the loser fails instead of
 * overwriting the key the winner may already have used.
 */
export async function addRecord(
  db: IDBDatabase,
  id: string,
  value: unknown,
): Promise<boolean> {
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const request = transaction.objectStore(STORE_NAME).add(value, id)
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

/** Replaces a record that already exists. Use only for fields that can race. */
export async function putRecord(
  db: IDBDatabase,
  id: string,
  value: unknown,
): Promise<void> {
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  await settle(transaction.objectStore(STORE_NAME).put(value, id))
}
