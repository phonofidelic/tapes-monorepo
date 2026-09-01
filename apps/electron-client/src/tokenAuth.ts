import crypto from 'crypto'
import type http from 'http'

/**
 * The one bearer-token check shared by every surface the embedded server
 * exposes: the `/blobs` routes (see blobHttp.ts) and the sync socket's upgrade
 * (see syncServer.ts). The token is minted once per install into
 * `sync-server.json` and handed to guests through the QR pairing URL, so both
 * surfaces are gated by the same secret and must compare it the same way.
 */

export function timingSafeMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) {
    return false
  }
  return crypto.timingSafeEqual(left, right)
}

/**
 * Accepts the token as an `Authorization: Bearer` header or as `?t=`. The
 * query form is not a convenience: a browser cannot set headers on a
 * `WebSocket` (nor on a plain `<audio src>` streaming a range), so for a guest
 * it is the only form available.
 *
 * A caller that passes no token is unguarded, which only happens in tests that
 * exercise the unauthenticated shape.
 */
export function isAuthorized(
  request: Pick<http.IncomingMessage, 'headers'>,
  url: URL,
  token?: string,
): boolean {
  if (!token) {
    return true
  }
  const header = request.headers.authorization
  if (header?.startsWith('Bearer ')) {
    return timingSafeMatch(header.slice('Bearer '.length), token)
  }
  const query = url.searchParams.get('t')
  return query !== null && timingSafeMatch(query, token)
}
