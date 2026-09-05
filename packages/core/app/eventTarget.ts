import type { SyncServerInfo } from './IpcService'

/**
 * Which host holds a library's playback numbers.
 *
 * One seam for both directions. Plays are flushed to a host and read back from
 * a host, and if those two resolved separately they could disagree — a device
 * reporting its plays to the server it syncs with while reading counts off its
 * own embedded store, which is exactly how it would show zeros for a library
 * it had been playing all week. So reads and writes both come through here.
 *
 * This is the failure TAP-74 fixed for blobs, in a second place: an electron
 * client in remote-sync mode still runs its own embedded host, so "ask the
 * local one" is always *available* and usually wrong.
 *
 * Unlike blobs there is no list to fall back through. Bytes are content
 * addressed, so any host holding them will do; a play count is not — two hosts
 * hold different halves of the truth, and asking a second one after the first
 * says "nothing" would report the wrong number rather than none.
 */
export type EventHost =
  /**
   * This device's own embedded host, read in-process. Electron only: the
   * renderer is in the same process tree as the store, so there is no reason
   * to pay for HTTP and a token to reach it.
   */
  | { kind: 'ipc' }
  /** Another host's `/events` surface, over the network. */
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
 * The owner of this device's library, under the interim rule: the remote edge
 * when the device has one, else the local host.
 *
 * That rule is temporary and known to be crude — it assumes a device with a
 * remote edge is a guest of it, which stops being true the moment a device is
 * a guest of one library and a host of another. TAP-105 replaces it with an
 * ownership record, at which point this function keeps its signature and
 * changes its mind about how it answers. Callers should stay uninterested in
 * how the choice is made.
 *
 * `undefined` is a supported answer, not a failure: a standalone web-client is
 * paired with nothing, has nowhere to send plays and no numbers to read back.
 */
export function resolveEventTarget(
  input: ResolveEventTargetInput,
): EventHost | undefined {
  const { syncServerInfo, origin, servedByHost, isDev, remoteSyncServerUrl } =
    input

  // First, because a device paired with a remote host is a guest of it: its
  // plays go there and its counts come from there, even though it is perfectly
  // capable of answering itself.
  if (remoteSyncServerUrl && input.token) {
    const derived = deriveHttpOrigin(remoteSyncServerUrl)
    if (derived) {
      return { kind: 'http', baseUrl: derived, token: input.token }
    }
  }

  // An embedded host of our own, reached in-process.
  if (syncServerInfo?.blobBaseUrl) {
    return { kind: 'ipc' }
  }

  // A hosted web guest: the page's own origin serves `/events`, and in
  // development Vite proxies it back to the host.
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
 * The sync socket and the HTTP surface are the same server on the same port,
 * so the origin to read from is the sync URL with its scheme swapped.
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
