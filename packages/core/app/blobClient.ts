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

export type ResolveBlobEndpointInput = {
  /** Electron only: the embedded host's own advertised surface. */
  syncServerInfo?: Pick<SyncServerInfo, 'blobBaseUrl' | 'blobToken'>
  /** Origin of the page, when there is one. */
  origin?: string
  /** True when this bundle is being served by the electron host. */
  servedByHost?: boolean
  isDev?: boolean
  /** `ws(s)://host:port/sync` from settings, when the user set one. */
  remoteSyncServerUrl?: string
  /** Pairing token, stored by the web-client from the QR `bt` parameter. */
  token?: string
}

/**
 * Mirrors the sync-URL precedence in apps/web-client/src/syncServerUrl.ts, but
 * lives here so both shells resolve it the same way.
 *
 * Returning `undefined` is a supported outcome, not a failure: a standalone
 * web-client with no host has nowhere to put bytes, and keeps them in OPFS.
 */
export function resolveBlobEndpoint(
  input: ResolveBlobEndpointInput,
): BlobEndpoint | undefined {
  const { syncServerInfo, origin, servedByHost, isDev, remoteSyncServerUrl } =
    input

  if (syncServerInfo?.blobBaseUrl) {
    return {
      baseUrl: trimSlash(syncServerInfo.blobBaseUrl),
      token: syncServerInfo.blobToken,
    }
  }

  if (origin && (servedByHost || isDev)) {
    // Same origin as the page: in production this server serves both, and in
    // development Vite proxies `/blobs` back to it.
    return { baseUrl: trimSlash(origin), token: input.token }
  }

  if (remoteSyncServerUrl && input.token) {
    // A remote host is only usable for blobs if we were also paired with it;
    // without a token every request would just 401.
    const derived = deriveHttpOrigin(remoteSyncServerUrl)
    if (derived) {
      return { baseUrl: derived, token: input.token }
    }
  }

  return undefined
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
  options: { signal?: AbortSignal } = {},
): Promise<Blob> {
  const response = await fetch(blobUrl(endpoint, hash), {
    headers: authHeaders(endpoint),
    signal: options.signal,
  })
  if (!response.ok) {
    throw await failure(response)
  }
  return response.blob()
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
