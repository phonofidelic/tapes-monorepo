import crypto from 'crypto'
import type http from 'http'

/**
 * The one bearer-token check shared by the HTTP routes and the sync socket's
 * upgrade. The token is minted once per install into the sync-server config
 * and handed to guests through the QR pairing url. Both surfaces are gated by
 * the same secret and must compare it the same way.
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
 * Accepts the token as a bearer header or as the `t` query parameter. The
 * query form is not a convenience. A browser cannot set headers on a WebSocket
 * or on an audio element streaming a range, so a guest has no other form.
 *
 * A caller that passes no token is unguarded. Only tests that exercise the
 * unauthenticated shape do that.
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
