import crypto from 'crypto'
import {
  checkPasskeyRecordWrite,
  decodeSignedStatement,
  parseBackupText,
  passkeyRecordKey,
  sha256Hex,
  toBase64Url,
  UNLOCK_PASSKEY,
} from '@tapes-monorepo/provenance'
import {
  MAX_RECORDS_PER_PERSON,
  type PasskeyRecordFetchResponse,
  type PasskeyRecordResponse,
} from '@tapes-monorepo/sync-protocol'
import type { PersonRoster, StoredPasskeyRecord } from './personRoster'

/**
 * The passkey records this host keeps for the people on its roster, so that a
 * replacement phone has somewhere to fetch its person key back from. A record
 * is stored under the credential id of the passkey that unlocks it.
 *
 * The host cannot read a record and never holds a person key. What it guards
 * is the write: an overwrite would take away a person's way back, so a write
 * must be signed by the person key the record names, over a host challenge.
 *
 * Do not import `electron` here. The sync server uses this module, and it
 * stays testable in a plain node process.
 */

/** Fetches allowed per credential id inside one window. */
export const MAX_FETCHES_PER_WINDOW = 10
export const FETCH_WINDOW_MS = 60_000

export type PasskeyRecordStore = {
  /** Stores or replaces the record for the credential id the write names. */
  put(
    encodedWrite: string,
    record: string,
    token: string,
  ): Promise<PasskeyRecordResponse>
  /** The record for a credential id, to whoever holds its passkey. */
  fetch(
    credentialId: string,
    token: string,
  ): Promise<PasskeyRecordFetchResponse>
}

/** One answer for no record and for a wrong token. */
const NO_RECORD: PasskeyRecordFetchResponse = { ok: false, error: 'no-record' }

export function createPasskeyRecordStore({
  roster,
  consumeChallenge,
  now = () => new Date(),
}: {
  roster: PersonRoster
  consumeChallenge: (challenge: string) => boolean
  now?: () => Date
}): PasskeyRecordStore {
  // Guessing a 32-byte token is hopeless, so this is only here to blunt a
  // peer that hammers the route. Keyed by credential id, not by caller.
  const fetches = new Map<string, { count: number; until: number }>()

  function throttled(credentialId: string): boolean {
    const at = now().getTime()
    const window = fetches.get(credentialId)
    if (!window || window.until <= at) {
      fetches.set(credentialId, { count: 1, until: at + FETCH_WINDOW_MS })
      // The map only grows with credential ids that were asked for, and a
      // stale window is replaced in place. Sweep the rest as we go.
      for (const [key, value] of fetches) {
        if (value.until <= at) {
          fetches.delete(key)
        }
      }
      return false
    }
    window.count += 1
    return window.count > MAX_FETCHES_PER_WINDOW
  }

  return {
    async put(encodedWrite, record, token) {
      const signed = decodeSignedStatement(encodedWrite)
      if (!signed || typeof record !== 'string' || typeof token !== 'string') {
        return { ok: false, error: 'malformed' }
      }
      const checked = await checkPasskeyRecordWrite(signed, record)
      if (!checked.ok) {
        return {
          ok: false,
          error:
            checked.problem === 'bad-signature'
              ? 'bad-signature'
              : checked.problem === 'wrong-record'
                ? 'bad-record'
                : 'malformed',
        }
      }
      const { personKey, credentialId, challenge } = checked.write.payload

      // The record has to be a passkey record for the credential id the write
      // names, holding the public key that signed the write. Otherwise a
      // person could park someone else's record, or their own under the wrong
      // credential id, where no passkey would ever open it.
      const parsed = parseBackupText(record)
      if (
        !parsed.ok ||
        parsed.backup.unlock.method !== UNLOCK_PASSKEY ||
        passkeyRecordKey(parsed.backup) !== credentialId ||
        toBase64Url(parsed.backup.publicKey) !== personKey
      ) {
        return { ok: false, error: 'bad-record' }
      }
      if (!consumeChallenge(challenge)) {
        return { ok: false, error: 'stale-challenge' }
      }

      // A credential id belongs to the first person who stored one under it.
      const owner = (await roster.list()).find((entry) =>
        entry.passkeyRecords?.some(
          (held) => held.credentialId === credentialId,
        ),
      )
      if (owner && owner.personKey !== personKey) {
        return { ok: false, error: 'not-yours' }
      }

      const stored: StoredPasskeyRecord = {
        credentialId,
        tokenHash: await sha256Hex(new TextEncoder().encode(token)),
        record,
        storedAt: now().toISOString(),
      }
      let error: PasskeyRecordResponse | undefined
      const written = await roster.update(personKey, (entry) => {
        const held = entry.passkeyRecords ?? []
        const kept = held.filter(
          (record) => record.credentialId !== credentialId,
        )
        if (kept.length >= MAX_RECORDS_PER_PERSON) {
          error = { ok: false, error: 'too-many-records' }
          return undefined
        }
        return { ...entry, passkeyRecords: [...kept, stored] }
      })
      if (error) {
        return error
      }
      return written ? { ok: true } : { ok: false, error: 'unknown-person' }
    },

    async fetch(credentialId, token) {
      if (
        typeof credentialId !== 'string' ||
        typeof token !== 'string' ||
        !credentialId ||
        throttled(credentialId)
      ) {
        return NO_RECORD
      }
      for (const entry of await roster.list()) {
        for (const held of entry.passkeyRecords ?? []) {
          if (
            held.credentialId === credentialId &&
            same(
              held.tokenHash,
              await sha256Hex(new TextEncoder().encode(token)),
            )
          ) {
            return { ok: true, record: held.record }
          }
        }
      }
      return NO_RECORD
    },
  }
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}
