/**
 * The routes a guest uses to keep a passkey record on its host, and to fetch
 * it back onto a phone that has nothing else.
 *
 * Both are POSTs, and both are guarded by the pairing token like every other
 * route. Reading is a POST because the fetch carries the token the passkey
 * derives, which has no business in a URL or a server log.
 */

/**
 * `POST` with a `PasskeyRecordBody` stores the record for one credential id,
 * replacing the one already there.
 */
export const PASSKEY_RECORDS_PATH = '/person-key-records'

/** `POST` with a `PasskeyRecordFetchBody` returns one record. */
export const PASSKEY_RECORD_FETCH_PATH = `${PASSKEY_RECORDS_PATH}/fetch`

/** How many passkeys one person can keep a record for on one host. */
export const MAX_RECORDS_PER_PERSON = 5

export type PasskeyRecordBody = {
  /** The encoded Signed<PasskeyRecordWrite>, over a host challenge. */
  write: string
  /** The record's file form, which the write's hash covers. */
  record: string
  /**
   * The service auth token the passkey derives. The host keeps only a hash of
   * it, and asks for it again before handing the record back.
   */
  token: string
}

export type PasskeyRecordError =
  | 'malformed'
  /** Not a method 2 record, or not one for the credential id it names. */
  | 'bad-record'
  | 'bad-signature'
  /** The challenge was not issued here, or was used already. */
  | 'stale-challenge'
  /** The signer is not on this host's roster. */
  | 'unknown-person'
  /** Another person already keeps a record under that credential id. */
  | 'not-yours'
  | 'too-many-records'

export type PasskeyRecordResponse =
  { ok: true } | { ok: false; error: PasskeyRecordError }

export type PasskeyRecordFetchBody = {
  /** The base64url credential id the ceremony returned. */
  credentialId: string
  /** The service auth token derived from that passkey's PRF output. */
  token: string
}

export type PasskeyRecordFetchResponse =
  | { ok: true; record: string }
  /**
   * No record, or the wrong token. They are one answer, so a peer with the
   * pairing token cannot learn which credential ids this host holds.
   */
  | { ok: false; error: 'no-record' }
