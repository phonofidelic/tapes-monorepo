/**
 * Resolves the Automerge sync server URL for this bundle, or `undefined` to run
 * local-only. The precedence chain is documented in `main.tsx`, which is the
 * only caller; everything here takes its inputs as arguments so the chain can
 * be exercised in tests without a browser or a running Electron host.
 */

export type SyncUrlEnv = {
  VITE_SYNC_SERVER_URL?: string
  VITE_SERVED_BY_HOST?: string
  DEV?: boolean
}

export type SyncUrlLocation = {
  protocol: string
  host: string
}

export function resolveSyncServerUrl({
  env,
  location,
  storage,
  token,
}: {
  env: SyncUrlEnv
  location: SyncUrlLocation
  storage: Pick<Storage, 'getItem'>
  /**
   * The pairing token this device was handed by the host, when it has one. It
   * is only ever presented to the host itself (the same-origin case below): a
   * remote or build-time server is a different deployment with a different
   * secret, and sending this one there would just leak it.
   */
  token?: string
}): string | undefined {
  // 1. Build-time env var: the Vercel deploy path.
  if (env.VITE_SYNC_SERVER_URL) {
    return env.VITE_SYNC_SERVER_URL
  }

  // 2. A remote server the user opted into from Settings. Unlike the Electron
  // renderer this ignores `syncServerMode`: there is no embedded server in a
  // browser, so a stored URL means "sync with this" and clearing it means
  // "local-only".
  const remoteSyncServerUrl = readRemoteSyncServerUrl(storage)
  if (remoteSyncServerUrl) {
    return remoteSyncServerUrl
  }

  // 3 & 4. Same-origin `/sync`. In development that is the Vite dev server
  // proxying to the host's embedded sync server (see vite.config.ts). In a
  // staged build it is the Electron host itself, whose WebSocketServer is
  // attached to the whole http server, so it accepts the upgrade on `/sync`.
  // The host checks the pairing token on that upgrade. A browser cannot set
  // headers on a WebSocket, so the token rides the query as `?t=`, the same
  // form `/blobs` accepts. Without a token the URL is still returned, so the
  // failure is a visible 401 rather than a silent local-only session.
  if (env.DEV || env.VITE_SERVED_BY_HOST === 'true') {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const query = token ? `?t=${encodeURIComponent(token)}` : ''
    return `${scheme}://${location.host}/sync${query}`
  }

  // 5. A standalone static deploy has nothing to sync with.
  return undefined
}

/**
 * Reads `remoteSyncServerUrl` out of the settings blob core's SettingsProvider
 * writes to localStorage, mirroring the pre-mount read in the Electron
 * renderer. Anything unusable (absent key, malformed JSON, a URL that is not
 * `ws:` or `wss:`) resolves to undefined, so the caller falls through rather
 * than handing Automerge an address that can only produce reconnect noise.
 */
function readRemoteSyncServerUrl(
  storage: Pick<Storage, 'getItem'>,
): string | undefined {
  let settings: unknown
  try {
    settings = JSON.parse(storage.getItem('settings') ?? '{}')
  } catch {
    return undefined
  }

  if (typeof settings !== 'object' || settings === null) {
    return undefined
  }

  const { remoteSyncServerUrl } = settings as {
    remoteSyncServerUrl?: unknown
  }

  if (typeof remoteSyncServerUrl !== 'string') {
    return undefined
  }

  // The same validation the Settings UI applies before storing a value.
  try {
    const { protocol } = new URL(remoteSyncServerUrl)
    return protocol === 'ws:' || protocol === 'wss:'
      ? remoteSyncServerUrl
      : undefined
  } catch {
    return undefined
  }
}
