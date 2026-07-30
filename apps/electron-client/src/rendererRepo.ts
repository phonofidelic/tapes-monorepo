import type { NetworkAdapterInterface } from '@automerge/automerge-repo'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import type { SyncServerInfo } from '@tapes-monorepo/core'

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
type SyncSettings = {
  syncServerMode?: string
  remoteSyncServerUrl?: string
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

  const { syncServerMode, remoteSyncServerUrl } = parsed as {
    syncServerMode?: unknown
    remoteSyncServerUrl?: unknown
  }

  return {
    syncServerMode:
      typeof syncServerMode === 'string' ? syncServerMode : undefined,
    remoteSyncServerUrl: isSyncServerUrl(remoteSyncServerUrl)
      ? remoteSyncServerUrl
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

export function resolveSyncServerUrls({
  settings,
  serverInfo,
  envSyncServerUrl,
}: {
  settings: SyncSettings
  serverInfo: SyncServerInfo | undefined
  envSyncServerUrl?: string
}): SyncServerUrls {
  const localUrl = serverInfo?.running ? serverInfo.url : undefined

  const remoteUrl =
    settings.syncServerMode === 'remote'
      ? (settings.remoteSyncServerUrl ?? envSyncServerUrl)
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
