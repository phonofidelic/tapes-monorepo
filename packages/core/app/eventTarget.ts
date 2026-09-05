import type { SyncServerInfo } from './IpcService'

/**
 * Picks the host that holds a library's playback numbers.
 *
 * Sending plays and reading counts must resolve to the same host. If they
 * differ, a device reports plays to one host and reads zeros from another.
 * So both directions call `resolveEventTarget` rather than choosing for
 * themselves.
 *
 * There is no second host to fall back to. A play count lives on one host, so
 * asking another returns a wrong number rather than none.
 */
export type EventHost =
  /** This device's own embedded host, read in the same process. Electron only. */
  | { kind: 'ipc' }
  /** Another host's event routes, over the network. */
  | { kind: 'http'; baseUrl: string; token?: string }

export type ResolveEventTargetInput = {
  /** Electron only: the embedded host's own advertised surface. */
  syncServerInfo?: Pick<SyncServerInfo, 'blobBaseUrl' | 'pairingToken'>
  /** Origin of the page, when there is one. */
  origin?: string
  /** True when this bundle is being served by the electron host. */
  servedByHost?: boolean
  isDev?: boolean
  /** `ws(s)://host:port/sync` from settings, when the user set one. */
  remoteSyncServerUrl?: string
  /** Pairing token for a host other than this device's own embedded one. */
  token?: string
}

/**
 * Returns the host that owns this device's library.
 *
 * The current rule is the paired remote server when the device has one, and
 * the local host otherwise. It assumes a device with a remote server is a
 * guest of it. That stops being true once a device is a guest of one library
 * and a host of another, so an ownership record will replace it. Callers only
 * need the answer, not the rule.
 *
 * Returning nothing is a normal outcome. A standalone web client is paired
 * with no one, so it has no numbers to read.
 */
export function resolveEventTarget(
  input: ResolveEventTargetInput,
): EventHost | undefined {
  const { syncServerInfo, origin, servedByHost, isDev, remoteSyncServerUrl } =
    input

  // Checked first. A device paired with a remote server is a guest of it, even
  // when it runs a host of its own.
  if (remoteSyncServerUrl && input.token) {
    const derived = deriveHttpOrigin(remoteSyncServerUrl)
    if (derived) {
      return { kind: 'http', baseUrl: derived, token: input.token }
    }
  }

  // Our own embedded host, read in the same process.
  if (syncServerInfo?.blobBaseUrl) {
    return { kind: 'ipc' }
  }

  // A web guest the host is serving. Its own origin carries the event routes.
  // In development the Vite server proxies them back to the host.
  if (origin && (servedByHost || isDev)) {
    return { kind: 'http', baseUrl: trimSlash(origin), token: input.token }
  }

  return undefined
}

/** Whether two resolutions are the same host, so effects can skip a refetch. */
export function sameEventTarget(
  a: EventHost | undefined,
  b: EventHost | undefined,
): boolean {
  if (!a || !b) {
    return a === b
  }
  if (a.kind !== b.kind) {
    return false
  }
  if (a.kind === 'ipc' || b.kind === 'ipc') {
    return true
  }
  return a.baseUrl === b.baseUrl && a.token === b.token
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Turns a sync socket url into the http origin to read from.
 *
 * The socket and the HTTP routes are one server on one port, so only the
 * scheme differs.
 */
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
