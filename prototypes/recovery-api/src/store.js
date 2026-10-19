// @ts-check
// THROWAWAY PROTOTYPE (TAP-220). Not production code.
//
// Stores one opaque encrypted blob per passkey credential id. The store never
// sees the wrapping key. It keeps only a sha-256 of the auth token, so a leak
// of the data directory does not let anyone fetch blobs through the API.

import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @typedef {{ v: number, alg: string, iv: string, ct: string }} Blob
 * @typedef {{ authHash: string, blob: Blob, createdAt: string, updatedAt: string }} Entry
 * @typedef {{
 *   get(id: string): Promise<Entry | undefined>,
 *   put(id: string, entry: Entry): Promise<void>,
 *   delete(id: string): Promise<void>,
 * }} Backend
 */

/** @param {string} token */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

/** @param {string} a @param {string} b */
function sameHash(a, b) {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

/** @returns {Backend} */
export function memoryBackend() {
  /** @type {Map<string, Entry>} */
  const entries = new Map()
  return {
    async get(id) {
      return entries.get(id)
    },
    async put(id, entry) {
      entries.set(id, entry)
    },
    async delete(id) {
      entries.delete(id)
    },
  }
}

/** One JSON file per credential. Fine for a prototype, not for real traffic. */
/** @param {string} dir @returns {Backend} */
export function fileBackend(dir) {
  // Credential ids are base64url, checked by the caller, so they are safe names.
  /** @param {string} id */
  const path = (id) => join(dir, `${id}.json`)
  return {
    async get(id) {
      try {
        return JSON.parse(await readFile(path(id), 'utf8'))
      } catch {
        return undefined
      }
    },
    async put(id, entry) {
      await mkdir(dir, { recursive: true })
      await writeFile(path(id), JSON.stringify(entry))
    },
    async delete(id) {
      await rm(path(id), { force: true })
    },
  }
}

/**
 * The backup rules on top of a backend. Each method returns a status the HTTP
 * layer maps to a response code.
 * @param {Backend} backend
 */
export function createStore(backend) {
  return {
    /**
     * Creates a backup, or replaces one the caller already owns.
     * @param {string} id @param {string} token @param {Blob} blob
     * @returns {Promise<'created' | 'replaced' | 'forbidden'>}
     */
    async save(id, token, blob) {
      const now = new Date().toISOString()
      const existing = await backend.get(id)
      if (existing) {
        if (!sameHash(existing.authHash, hashToken(token))) return 'forbidden'
        await backend.put(id, { ...existing, blob, updatedAt: now })
        return 'replaced'
      }
      await backend.put(id, {
        authHash: hashToken(token),
        blob,
        createdAt: now,
        updatedAt: now,
      })
      return 'created'
    },

    /**
     * A wrong token and a missing id give the same answer. That way the API
     * does not reveal which credential ids have a backup.
     * @param {string} id @param {string} token
     * @returns {Promise<Blob | undefined>}
     */
    async fetch(id, token) {
      const existing = await backend.get(id)
      if (!existing || !sameHash(existing.authHash, hashToken(token))) {
        return undefined
      }
      return existing.blob
    },

    /** @param {string} id @param {string} token @returns {Promise<boolean>} */
    async remove(id, token) {
      const existing = await backend.get(id)
      if (!existing || !sameHash(existing.authHash, hashToken(token))) {
        return false
      }
      await backend.delete(id)
      return true
    },
  }
}
