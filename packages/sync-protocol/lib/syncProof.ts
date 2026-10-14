/**
 * Where a guest gets a challenge to sign, and where it sends the signed proof.
 *
 * The guest fetches a fresh challenge before each socket it opens, then sends
 * the encoded proof on the upgrade request next to the pairing token. A proof
 * is single-use, so a reconnect needs a new one.
 *
 * A missing or failed proof never refuses the socket. The connection is kept,
 * but the host does not count it as that device in a session record.
 */

/**
 * HTTP path that answers with a fresh challenge, guarded by the pairing token.
 * It is not under `/sync`, because the web-client dev server proxies that
 * prefix as a websocket.
 */
export const SYNC_CHALLENGE_PATH = '/challenge'

/** The JSON body of a challenge response. */
export type SyncChallengeResponse = { challenge: string }

/** Query parameter carrying the encoded signed proof, next to `t` and `d`. */
export const SYNC_PROOF_PARAM = 'p'

/** Adds an encoded proof to a sync url, replacing any earlier one. */
export function withSyncProof(url: string, proof: string): string {
  const withProof = new URL(url)
  withProof.searchParams.set(SYNC_PROOF_PARAM, proof)
  return withProof.toString()
}

/**
 * The http(s) url of the challenge route on the host a sync url points at. A
 * ws url maps to http and a wss url to https, on the same host and port.
 */
export function syncChallengeUrl(syncUrl: string): string {
  const url = new URL(syncUrl)
  const protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  return `${protocol}//${url.host}${SYNC_CHALLENGE_PATH}`
}
