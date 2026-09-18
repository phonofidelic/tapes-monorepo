/**
 * Shared by the page and the blob-auth service worker: where the pairing token
 * is kept, and how an authenticated `/blobs` request is built.
 *
 * The token lives in Cache Storage rather than travelling in a message. Both
 * sides open that store directly, so a worker the browser restarted needs no
 * handshake and has nothing to replay.
 */

/** Holds the single entry below. Named so it is recognisable in devtools. */
const TOKEN_CACHE = 'tapes-pairing-token'

/**
 * Key for that entry. Cache Storage takes only requests, so the key is a URL.
 * Nothing is ever served from this path.
 */
const TOKEN_KEY = '/__tapes-pairing-token'

/** Writes the token the worker will read, or clears it when there is none. */
export async function storePairingToken(
  token: string | undefined,
): Promise<void> {
  const cache = await caches.open(TOKEN_CACHE)
  if (!token) {
    await cache.delete(TOKEN_KEY)
    return
  }
  await cache.put(TOKEN_KEY, new Response(token))
}

export async function readPairingToken(): Promise<string | undefined> {
  const cache = await caches.open(TOKEN_CACHE)
  const stored = await cache.match(TOKEN_KEY)
  return (await stored?.text()) || undefined
}

/**
 * Whether the worker should add a header to this request. `origin` is the
 * worker's own origin. A blob fetched from some other host comes from the
 * page's own `fetch`, which sets its headers itself.
 *
 * GET only. Uploads are POSTs the page makes, and they already carry the
 * header. Rebuilding one here would mean passing its body through the worker.
 */
export function isBlobRequest(request: Request, origin: string): boolean {
  if (request.method !== 'GET') {
    return false
  }
  const url = new URL(request.url)
  if (url.origin !== origin) {
    return false
  }
  return url.pathname === '/blobs' || url.pathname.startsWith('/blobs/')
}

/** Copies a request and adds the pairing token as a bearer header. */
export function authorizeBlobRequest(request: Request, token: string): Request {
  // Built from scratch rather than cloned. An audio element issues its request
  // in no-cors mode, and that mode's header guard drops an added Authorization
  // without saying so.
  const headers = new Headers()
  // Every original header comes across. The range header matters most: lose it
  // and a seek turns into a fetch of the whole file.
  request.headers.forEach((value, name) => headers.set(name, value))
  headers.set('Authorization', `Bearer ${token}`)
  return new Request(request.url, {
    method: request.method,
    headers,
    mode: 'cors',
    credentials: 'omit',
    redirect: 'follow',
  })
}
