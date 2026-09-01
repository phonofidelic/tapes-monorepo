import type { SyncServerInfo } from './IpcService'
import type { BlobDescriptor } from './types'

/**
 * Client for the host's `/blobs` surface.
 *
 * Recorded audio is addressed by the sha-256 of its bytes and lives on the
 * sync host, not in the Automerge doc. Guests upload what they record and
 * fetch what they play; the doc carries only the descriptor.
 *
 * The hash is always computed by the host while it streams the upload, never
 * here: a phone would otherwise have to read a 50 MB+ file to hash it, and
 * `crypto.subtle` is unavailable in the plain-HTTP LAN mode the host can be
 * configured into.
 */

export type BlobEndpoint = {
  /** Origin serving `/blobs`, without a trailing slash. */
  baseUrl: string
  token?: string
  /**
   * True when this endpoint is this device's own embedded host, i.e. the bytes
   * are already on local disk. Callers use it to decide what a local copy is
   * worth: pinning a blob that is served from this machine's own store buys
   * nothing, while pinning one that lives on another host does.
   */
  local?: boolean
}

export class BlobRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'BlobRequestError'
  }
}

/** What one host did when it was asked for a blob. */
export type BlobAttempt =
  { kind: 'status'; status: number } | { kind: 'network' }

/**
 * Why a blob could not be fetched.
 *
 * A fetch used to surface whichever error happened to come last, which left a
 * host that is reachable but no longer paired indistinguishable from one that
 * is switched off — both reached the player as the same "not available
 * offline". The reason is decided across every attempt rather than by the
 * final one.
 */
export type BlobFailureReason =
  /** No host is configured at all: this device is paired with nothing. */
  | 'unpaired'
  /** Reachable, but our token is missing or no longer accepted. */
  | 'unauthorized'
  /** Every host that answered said it does not hold these bytes. */
  | 'missing'
  /** Nobody could be asked: connection refused, DNS, timeout, 5xx. */
  | 'unreachable'

export class BlobFetchError extends Error {
  constructor(
    readonly reason: BlobFailureReason,
    readonly attempts: readonly BlobAttempt[],
    options?: { cause?: unknown },
  ) {
    super(`Could not fetch blob from any host (${reason})`, options)
    this.name = 'BlobFetchError'
  }
}

/**
 * Precedence when hosts disagree: a 401 is the one failure the user can act on
 * — re-pair — so it must never be masked by another host answering 404. An
 * unreachable host outranks a 404 in turn, because "nobody could be asked" is
 * a weaker claim than "every host that answered said no".
 *
 * Anything else, 5xx included, is reported as unreachable: from the player's
 * side a host that is broken is not meaningfully different from one that is
 * away.
 */
export function classifyBlobFailure(
  attempts: readonly BlobAttempt[],
): BlobFailureReason {
  const sawStatus = (code: number) =>
    attempts.some(
      (attempt) => attempt.kind === 'status' && attempt.status === code,
    )
  if (sawStatus(401) || sawStatus(403)) {
    return 'unauthorized'
  }
  if (attempts.some((attempt) => attempt.kind === 'network')) {
    return 'unreachable'
  }
  if (sawStatus(404)) {
    return 'missing'
  }
  return 'unreachable'
}

/**
 * How long a host has to start answering. This bounds reaching the host and
 * getting response headers back, never the transfer: a ten-minute tape over a
 * slow LAN is a slow response, not an absent host.
 */
export const BLOB_RESPONSE_TIMEOUT_MS = 15_000

/**
 * `AbortSignal.any` would express this, but it is still missing from enough of
 * the browsers and test environments this runs in to be worth the few lines.
 */
function linkAbort(
  controller: AbortController,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) {
    return () => {}
  }
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => {}
  }
  const onAbort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', onAbort)
  return () => signal.removeEventListener('abort', onAbort)
}

export type ResolveBlobEndpointInput = {
  /** Electron only: the embedded host's own advertised surface. */
  syncServerInfo?: Pick<SyncServerInfo, 'blobBaseUrl' | 'pairingToken'>
  /** Origin of the page, when there is one. */
  origin?: string
  /** True when this bundle is being served by the electron host. */
  servedByHost?: boolean
  isDev?: boolean
  /** `ws(s)://host:port/sync` from settings, when the user set one. */
  remoteSyncServerUrl?: string
  /**
   * Pairing token for a host other than our own embedded one: the web-client
   * captures it from the pairing URL's `pt` parameter, the electron renderer
   * reads it from the `pairingToken` setting.
   */
  token?: string
}

/**
 * Every host this device could get bytes from, in the order to try them.
 *
 * Mirrors the sync-URL precedence in apps/web-client/src/syncServerUrl.ts, but
 * lives here so both shells resolve it the same way. Unlike that chain this one
 * does not stop at the first match: the electron renderer can be paired with a
 * remote server *in addition to* running its own embedded one (see
 * `syncServerMode: 'remote'`), and will then sync docs whose hashes only the
 * remote host has ever seen. Content addressing means any host holding the
 * bytes will do, so a miss on one is a reason to ask the next rather than to
 * fail — and no origin ever belongs in the shared doc, which would leak this
 * device's topology to every peer.
 *
 * The first entry is the *write* target: uploads and new claims go there. An
 * empty list is a supported outcome, not a failure — a standalone web-client
 * with no host has nowhere to put bytes, and keeps them in OPFS.
 */
export function resolveBlobEndpoints(
  input: ResolveBlobEndpointInput,
): BlobEndpoint[] {
  const { syncServerInfo, origin, servedByHost, isDev, remoteSyncServerUrl } =
    input
  const endpoints: BlobEndpoint[] = []

  if (syncServerInfo?.blobBaseUrl) {
    endpoints.push({
      baseUrl: trimSlash(syncServerInfo.blobBaseUrl),
      token: syncServerInfo.pairingToken,
      local: true,
    })
  }

  if (origin && (servedByHost || isDev)) {
    // Same origin as the page: in production this server serves both, and in
    // development Vite proxies `/blobs` back to it.
    endpoints.push({ baseUrl: trimSlash(origin), token: input.token })
  }

  if (remoteSyncServerUrl && input.token) {
    // A remote host is only usable for blobs if we were also paired with it;
    // without a token every request would just 401.
    const derived = deriveHttpOrigin(remoteSyncServerUrl)
    if (derived) {
      endpoints.push({ baseUrl: derived, token: input.token })
    }
  }

  // The page origin and an explicitly configured remote can be the same host,
  // and asking it twice for a blob it does not have only doubles the latency of
  // the failure.
  return endpoints.filter(
    (endpoint, index) =>
      endpoints.findIndex((other) => other.baseUrl === endpoint.baseUrl) ===
      index,
  )
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function deriveHttpOrigin(syncUrl: string): string | undefined {
  try {
    const url = new URL(syncUrl)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return undefined
    }
    return `${url.protocol === 'wss:' ? 'https' : 'http'}://${url.host}`
  } catch {
    return undefined
  }
}

function authHeaders(endpoint: BlobEndpoint): Record<string, string> {
  return endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}
}

function blobUrl(endpoint: BlobEndpoint, hash: string): string {
  return `${endpoint.baseUrl}/blobs/${hash}`
}

async function failure(response: Response): Promise<BlobRequestError> {
  let message = response.statusText
  try {
    const body = (await response.json()) as { error?: string }
    if (body.error) {
      message = body.error
    }
  } catch {
    // Non-JSON body; the status text will do.
  }
  return new BlobRequestError(response.status, message)
}

/**
 * Uploads recorded bytes and returns the descriptor to write into the doc.
 *
 * `body` should be the OPFS `File` handle rather than a materialized buffer —
 * `fetch` streams it off disk, so a large recording never has to fit in JS
 * memory on a phone.
 */
export async function uploadBlob(
  endpoint: BlobEndpoint,
  body: Blob,
  options: { mimeType: string; docUrl: string; signal?: AbortSignal },
): Promise<BlobDescriptor> {
  const response = await fetch(
    `${endpoint.baseUrl}/blobs?doc=${encodeURIComponent(options.docUrl)}`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(endpoint),
        'Content-Type': options.mimeType,
        'X-Tapes-Recording-Url': options.docUrl,
      },
      body,
      signal: options.signal,
    },
  )

  if (!response.ok) {
    throw await failure(response)
  }

  const descriptor = (await response.json()) as BlobDescriptor
  return {
    hash: descriptor.hash,
    size: descriptor.size,
    mimeType: descriptor.mimeType,
    ext: descriptor.ext,
  }
}

export async function fetchBlob(
  endpoint: BlobEndpoint,
  hash: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Blob> {
  // Without a deadline, a host that accepts the connection and then says
  // nothing leaves playback spinning forever instead of failing over to the
  // next host. The timer is cleared the moment the headers land, so only
  // reaching the host is on the clock and a long download is left alone.
  const controller = new AbortController()
  const unlink = linkAbort(controller, options.signal)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? BLOB_RESPONSE_TIMEOUT_MS)

  try {
    const response = await fetch(blobUrl(endpoint, hash), {
      headers: authHeaders(endpoint),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) {
      throw await failure(response)
    }
    // Awaited inside the `try` so the body is read before `finally` unlinks
    // the caller's signal, which is what still cancels a download in flight.
    return await response.blob()
  } catch (error) {
    // A timeout is this host failing to answer; the caller withdrawing the
    // question is not, and has to keep propagating as an abort.
    if (timedOut && !options.signal?.aborted) {
      throw new BlobRequestError(408, `${endpoint.baseUrl} did not respond`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    unlink()
  }
}

/** Presence check without transferring the body. Null when the host has no such blob. */
export async function headBlob(
  endpoint: BlobEndpoint,
  hash: string,
): Promise<{ size: number; mimeType: string } | null> {
  const response = await fetch(blobUrl(endpoint, hash), {
    method: 'HEAD',
    headers: authHeaders(endpoint),
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw await failure(response)
  }
  return {
    size: Number(response.headers.get('content-length') ?? 0),
    mimeType:
      response.headers.get('content-type') ?? 'application/octet-stream',
  }
}

/**
 * Releases this recording's claim on the bytes. The host unlinks them once no
 * document references the hash any more.
 */
export async function deleteBlob(
  endpoint: BlobEndpoint,
  hash: string,
  docUrl: string,
): Promise<void> {
  const response = await fetch(
    `${blobUrl(endpoint, hash)}?doc=${encodeURIComponent(docUrl)}`,
    { method: 'DELETE', headers: authHeaders(endpoint) },
  )
  // A blob that is already gone is a success from the caller's point of view.
  if (!response.ok && response.status !== 404) {
    throw await failure(response)
  }
}

/** What a multi-endpoint fetch found, and where. */
export type BlobFetchResult = {
  blob: Blob
  /** The endpoint that served the bytes. */
  from: BlobEndpoint
  /**
   * Endpoints that answered 404 before this one succeeded. They are reachable
   * and paired, they just do not hold this blob — the case `replicateBlob`
   * exists to repair.
   */
  missingFrom: BlobEndpoint[]
}

/**
 * Fetches a blob from the first host that has it.
 *
 * A 404 means "not this host, ask the next". Other failures are also worth
 * moving past — one host can be asleep while another answers. Every outcome is
 * kept rather than just the last one, because what the player needs to tell
 * the user is decided across all of them: one host answering 404 says nothing
 * about another that rejected our token.
 */
export async function fetchBlobFromAny(
  endpoints: readonly BlobEndpoint[],
  hash: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BlobFetchResult> {
  if (endpoints.length === 0) {
    throw new BlobFetchError('unpaired', [])
  }

  const missingFrom: BlobEndpoint[] = []
  const attempts: BlobAttempt[] = []
  let lastError: unknown

  for (const endpoint of endpoints) {
    try {
      const blob = await fetchBlob(endpoint, hash, options)
      return { blob, from: endpoint, missingFrom }
    } catch (error) {
      // An aborted fetch is the caller withdrawing the question, not a host
      // failing to answer it: trying the next one would ignore that.
      if (options.signal?.aborted) {
        throw error
      }
      if (error instanceof BlobRequestError) {
        attempts.push({ kind: 'status', status: error.status })
        if (error.status === 404) {
          missingFrom.push(endpoint)
        }
      } else {
        // A rejected `fetch` with no status: refused, DNS, CORS, offline.
        attempts.push({ kind: 'network' })
      }
      lastError = error
    }
  }

  throw new BlobFetchError(classifyBlobFailure(attempts), attempts, {
    cause: lastError,
  })
}

/**
 * Pushes bytes we already hold to hosts that turned out not to have them.
 *
 * Two hosts that both serve this library should both be able to answer for it;
 * the alternative is a recording that plays only while one particular machine
 * is awake. Best-effort by design — a failed copy leaves the blob exactly where
 * it was, so this never turns a successful playback into an error.
 */
export async function replicateBlob(
  endpoints: readonly BlobEndpoint[],
  blob: Blob,
  options: { mimeType: string; docUrl: string; expectedHash: string },
): Promise<void> {
  await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const descriptor = await uploadBlob(endpoint, blob, {
          mimeType: options.mimeType,
          docUrl: options.docUrl,
        })
        if (descriptor.hash !== options.expectedHash) {
          // The host hashes the bytes as it streams them, so a mismatch means
          // what we sent is not what the doc points at. Nothing to repair from
          // here, but it should not pass silently.
          console.warn(
            `Replicated blob hashed as ${descriptor.hash}, expected ${options.expectedHash}`,
          )
        }
      } catch (error) {
        console.warn('Could not replicate recording audio to a host:', error)
      }
    }),
  )
}

/**
 * Releases this recording's claim on every host that might be holding it.
 *
 * Which host has the bytes is deliberately not recorded anywhere, so the only
 * way to drop a claim is to drop it everywhere; `deleteBlob` already treats an
 * absent blob as success.
 */
export async function deleteBlobEverywhere(
  endpoints: readonly BlobEndpoint[],
  hash: string,
  docUrl: string,
): Promise<void> {
  await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        await deleteBlob(endpoint, hash, docUrl)
      } catch (error) {
        console.error('Could not release recording audio on a host:', error)
      }
    }),
  )
}
