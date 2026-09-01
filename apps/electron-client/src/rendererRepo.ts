import {
  Repo,
  type AutomergeUrl,
  type DocHandle,
  type NetworkAdapterInterface,
  type StorageAdapterInterface,
} from '@automerge/automerge-repo'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import type {
  BlobEndpoint,
  RecordingRepoState,
  SyncServerInfo,
} from '@tapes-monorepo/core'

/**
 * Where the renderer's repo syncs. The renderer holds no storage of its own —
 * the embedded sync server's `NodeFSStorageAdapter` is the disk of record (see
 * syncServer.ts) — so `localUrl` is what makes anything persist at all, and it
 * is kept even when the user has opted into a remote server.
 */
export type SyncServerUrls = {
  /** The embedded sync server, i.e. this app's own on-disk store. */
  localUrl?: string
  /** A remote server the user opted into, synced to in addition to the local one. */
  remoteUrl?: string
}

/** The subset of core's settings blob that decides where we sync. */
export type SyncSettings = {
  syncServerMode?: string
  remoteSyncServerUrl?: string
  /**
   * Pairing token for the remote server, when it is another Tapes host rather
   * than a bare sync server. It opens both that host's socket and its `/blobs`
   * surface, exactly as the token in a QR pairing URL does for a web guest.
   */
  pairingToken?: string
}

/**
 * Reads the sync-relevant fields out of the settings blob core's
 * SettingsProvider writes to localStorage. Anything unusable — malformed JSON,
 * a non-object, a URL that is not `ws:`/`wss:` — is dropped rather than passed
 * on, so a bad stored value falls through to the next candidate instead of
 * handing Automerge an address that can only produce reconnect noise. Mirrors
 * `readRemoteSyncServerUrl` in web-client's syncServerUrl.ts.
 */
export function readSyncSettings(
  storage: Pick<Storage, 'getItem'>,
): SyncSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(storage.getItem('settings') ?? '{}')
  } catch {
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {}
  }

  const { syncServerMode, remoteSyncServerUrl, pairingToken } = parsed as {
    syncServerMode?: unknown
    remoteSyncServerUrl?: unknown
    pairingToken?: unknown
  }

  return {
    syncServerMode:
      typeof syncServerMode === 'string' ? syncServerMode : undefined,
    remoteSyncServerUrl: isSyncServerUrl(remoteSyncServerUrl)
      ? remoteSyncServerUrl
      : undefined,
    pairingToken:
      typeof pairingToken === 'string' && pairingToken.length > 0
        ? pairingToken
        : undefined,
  }
}

/** The same validation the Settings UI applies before storing a value. */
function isSyncServerUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  try {
    const { protocol } = new URL(value)
    return protocol === 'ws:' || protocol === 'wss:'
  } catch {
    return false
  }
}

function withPairingToken(url: string, token?: string): string {
  if (!token) {
    return url
  }
  const withToken = new URL(url)
  withToken.searchParams.set('t', token)
  return withToken.toString()
}

export function resolveSyncServerUrls({
  settings,
  serverInfo,
  envSyncServerUrl,
}: {
  settings: SyncSettings
  serverInfo: SyncServerInfo | undefined
  envSyncServerUrl?: string
}): SyncServerUrls {
  // The embedded server verifies the pairing token on the upgrade, so even
  // its own renderer has to present it. `?t=` rather than a bearer header
  // because the adapter builds a browser `WebSocket`, which cannot set one.
  const localUrl = serverInfo?.running
    ? withPairingToken(serverInfo.url, serverInfo.pairingToken)
    : undefined

  // A remote Tapes host guards its socket the same way ours does, so present
  // the stored token there too. A bare sync server ignores the parameter.
  const configuredRemote =
    settings.syncServerMode === 'remote'
      ? (settings.remoteSyncServerUrl ?? envSyncServerUrl)
      : undefined
  const remoteUrl = configuredRemote
    ? withPairingToken(configuredRemote, settings.pairingToken)
    : undefined

  // No embedded server means nothing persists this session, so fall back to the
  // build-time server rather than leaving the app with no peer at all.
  if (!localUrl && !remoteUrl && envSyncServerUrl) {
    return { remoteUrl: envSyncServerUrl }
  }

  return { localUrl, remoteUrl }
}

export function buildRendererNetwork({
  localUrl,
  remoteUrl,
}: SyncServerUrls): NetworkAdapterInterface[] {
  return [localUrl, remoteUrl]
    .filter((url): url is string => Boolean(url))
    .map((url) => new BrowserWebSocketClientAdapter(url))
}

/** How long to wait for a peer to answer with the stored library. */
export const DEFAULT_FIND_TIMEOUT_MS = 10_000

export type RendererRepoBootstrap =
  | {
      status: 'ready'
      repo: Repo
      handle: DocHandle<unknown>
      /** Set only when a new library was created, for the caller to persist. */
      createdUrl?: AutomergeUrl
    }
  /** A library url is stored, but no repo we can reach holds that document. */
  | { status: 'unavailable' }

/**
 * Builds the repo the renderer runs on, and loads (or creates) the library in
 * it.
 *
 * The embedded sync server owns persistence — its `NodeFSStorageAdapter` is the
 * disk of record — so the repo normally carries no storage adapter of its own,
 * keeping the desktop library off the renderer's origin quota. Two cases still
 * need the browser-side store, which the caller supplies via `createStorage`:
 * no embedded server (nothing to persist to), and a pre-TAP-69 library the
 * server has never seen.
 */
export async function bootstrapRendererRepo({
  storedUrl,
  urls,
  createStorage,
  createNetwork = buildRendererNetwork,
  findTimeoutMs = DEFAULT_FIND_TIMEOUT_MS,
}: {
  storedUrl: AutomergeUrl | null
  urls: SyncServerUrls
  createStorage: () => StorageAdapterInterface
  createNetwork?: (urls: SyncServerUrls) => NetworkAdapterInterface[]
  findTimeoutMs?: number
}): Promise<RendererRepoBootstrap> {
  // Finds the stored library in `candidate`, or creates a fresh one when there
  // is nothing stored yet. Reports failure so the caller can try a different
  // repo rather than inventing a new document.
  const load = async (candidate: Repo): Promise<RendererRepoBootstrap> => {
    if (!storedUrl) {
      const handle = candidate.create<RecordingRepoState>({ recordings: [] })
      return {
        status: 'ready',
        repo: candidate,
        handle,
        createdUrl: handle.url,
      }
    }

    try {
      // A peer that never answers would otherwise leave `find` pending forever:
      // the websocket adapter reports itself ready a second after construction
      // whether or not it ever connected.
      const handle = await candidate.find(storedUrl, {
        signal: AbortSignal.timeout(findTimeoutMs),
      })
      return { status: 'ready', repo: candidate, handle }
    } catch (error) {
      console.info('Library not found in this repo', error)
      return { status: 'unavailable' }
    }
  }

  // Without a running embedded server there is nothing to persist to on disk,
  // so keep the browser-side store rather than running with no persistence.
  if (!urls.localUrl) {
    return load(
      new Repo({ storage: createStorage(), network: createNetwork(urls) }),
    )
  }

  const repo = new Repo({ network: createNetwork(urls) })
  const result = await load(repo)
  if (result.status === 'ready') {
    return result
  }

  // The server doesn't have the library. That's a pre-TAP-69 install, whose only
  // copy is in the renderer's own storage: run this session on the legacy
  // store-backed repo, which announces the library to the server so the next
  // launch finds it on disk. Once this has shipped for a release, the fallback
  // and the IndexedDB dependency can go.
  await repo.shutdown()
  return load(
    new Repo({ storage: createStorage(), network: createNetwork(urls) }),
  )
}

/**
 * The settings whose values feed `resolveSyncServerUrls`/`resolveBlobEndpoints`
 * above. A write to anything else (an audio format, a storage location) cannot
 * change where we sync, so the shell ignores it rather than making an IPC round
 * trip and rebuilding for nothing.
 *
 * The LAN and HTTPS toggles are in here because they change the embedded
 * server's own url: it restarts on a different host or scheme, and the renderer
 * has to reconnect to where it moved to.
 */
const SYNC_SETTING_KEYS: ReadonlySet<string> = new Set([
  'syncServerMode',
  'remoteSyncServerUrl',
  'pairingToken',
  'syncServerLanEnabled',
  'syncServerHttpsEnabled',
])

export function isSyncSetting(key: string): boolean {
  return SYNC_SETTING_KEYS.has(key)
}

export function sameSyncServerUrls(
  a: SyncServerUrls | null,
  b: SyncServerUrls | null,
): boolean {
  if (a === null || b === null) {
    return a === b
  }
  return a.localUrl === b.localUrl && a.remoteUrl === b.remoteUrl
}

export function sameBlobEndpoints(
  a: readonly BlobEndpoint[],
  b: readonly BlobEndpoint[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (endpoint, index) =>
        endpoint.baseUrl === b[index].baseUrl &&
        endpoint.token === b[index].token &&
        endpoint.local === b[index].local,
    )
  )
}

/**
 * Identifies the repo a given library url and set of servers would produce.
 * Re-resolving after an unrelated settings write usually lands on the same key,
 * and rebuilding then would drop every open websocket to hand back an identical
 * repo.
 */
export function rendererRepoKey(
  storedUrl: AutomergeUrl | null,
  urls: SyncServerUrls,
): string {
  return [storedUrl ?? '', urls.localUrl ?? '', urls.remoteUrl ?? ''].join('|')
}
