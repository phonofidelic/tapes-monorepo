import { describe, it, expect, vi } from 'vitest'
import type { SyncServerInfo } from '@tapes-monorepo/core'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import {
  buildRendererNetwork,
  isSyncSetting,
  readSyncSettings,
  rendererRepoKey,
  resolveSyncServerUrls,
  sameBlobEndpoints,
  sameSyncServerUrls,
} from './rendererRepo'

// buildRendererNetwork is asserted through the urls it is given: constructing a
// BrowserWebSocketClientAdapter here would open real sockets.
vi.mock('@automerge/automerge-repo-network-websocket', () => ({
  BrowserWebSocketClientAdapter: class {
    constructor(public url: string) {}
  },
}))

const runningServer: SyncServerInfo = {
  running: true,
  url: 'ws://127.0.0.1:9001',
  port: 9001,
  host: '127.0.0.1',
}

const stoppedServer: SyncServerInfo = {
  running: false,
  url: '',
  port: 0,
  host: '',
}

describe('resolveSyncServerUrls', () => {
  // The embedded server checks the token on every upgrade, its own renderer
  // included, and the adapter's browser WebSocket cannot send a header.
  it('carries the pairing token on the embedded server url', () => {
    expect(
      resolveSyncServerUrls({
        settings: {
          syncServerMode: 'remote',
          remoteSyncServerUrl: 'wss://sync.example.com',
        },
        serverInfo: { ...runningServer, pairingToken: 'host-token' },
      }),
    ).toEqual({
      localUrl: 'ws://127.0.0.1:9001/?t=host-token',
      // The embedded server's own token is not a credential anywhere else, so
      // the remote never sees it.
      remoteUrl: 'wss://sync.example.com',
    })
  })

  // A remote server that is another Tapes host guards its socket exactly as
  // ours does, and the same token opens its `/blobs` surface.
  it('presents the stored pairing token to a remote host', () => {
    expect(
      resolveSyncServerUrls({
        settings: {
          syncServerMode: 'remote',
          remoteSyncServerUrl: 'wss://sync.example.com/sync',
          pairingToken: 'guest-token',
        },
        serverInfo: { ...runningServer, pairingToken: 'host-token' },
      }).remoteUrl,
    ).toBe('wss://sync.example.com/sync?t=guest-token')
  })

  it('uses the embedded server when it is running', () => {
    expect(
      resolveSyncServerUrls({ settings: {}, serverInfo: runningServer }),
    ).toEqual({ localUrl: 'ws://127.0.0.1:9001', remoteUrl: undefined })
  })

  // The renderer holds no storage of its own, so dropping the local url in
  // remote mode would mean nothing persists to disk that session.
  it('keeps the embedded server alongside a remote one in remote mode', () => {
    expect(
      resolveSyncServerUrls({
        settings: {
          syncServerMode: 'remote',
          remoteSyncServerUrl: 'wss://sync.example.com',
        },
        serverInfo: runningServer,
      }),
    ).toEqual({
      localUrl: 'ws://127.0.0.1:9001',
      remoteUrl: 'wss://sync.example.com',
    })
  })

  it('ignores a configured remote url when not in remote mode', () => {
    expect(
      resolveSyncServerUrls({
        settings: { remoteSyncServerUrl: 'wss://sync.example.com' },
        serverInfo: runningServer,
      }).remoteUrl,
    ).toBeUndefined()
  })

  it('falls back to the build-time url in remote mode with none configured', () => {
    expect(
      resolveSyncServerUrls({
        settings: { syncServerMode: 'remote' },
        serverInfo: runningServer,
        envSyncServerUrl: 'wss://build-time.example.com',
      }).remoteUrl,
    ).toBe('wss://build-time.example.com')
  })

  // Without the embedded server nothing persists locally, but syncing to the
  // build-time server still beats having no peer at all.
  it('falls back to the build-time url when the embedded server is down', () => {
    expect(
      resolveSyncServerUrls({
        settings: {},
        serverInfo: stoppedServer,
        envSyncServerUrl: 'wss://build-time.example.com',
      }),
    ).toEqual({ remoteUrl: 'wss://build-time.example.com' })
  })

  it('resolves no urls when there is no server anywhere', () => {
    expect(
      resolveSyncServerUrls({ settings: {}, serverInfo: stoppedServer }),
    ).toEqual({ localUrl: undefined, remoteUrl: undefined })
  })

  it('resolves no urls when the server info never arrived', () => {
    expect(
      resolveSyncServerUrls({ settings: {}, serverInfo: undefined }),
    ).toEqual({ localUrl: undefined, remoteUrl: undefined })
  })
})

describe('readSyncSettings', () => {
  it('reads the settings blob core writes', () => {
    const storage = {
      getItem: () => JSON.stringify({ syncServerMode: 'remote' }),
    }

    expect(readSyncSettings(storage)).toEqual({ syncServerMode: 'remote' })
  })

  it.each([
    ['missing', null],
    ['corrupt', '{not json'],
    ['not an object', 'null'],
  ])('falls back to empty settings when the blob is %s', (_label, stored) => {
    const storage = { getItem: () => stored }

    expect(readSyncSettings(storage)).toEqual({})
  })

  it('keeps a websocket remote url', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({ remoteSyncServerUrl: 'wss://sync.example.com' }),
    }

    expect(readSyncSettings(storage).remoteSyncServerUrl).toBe(
      'wss://sync.example.com',
    )
  })

  // A stored value Automerge could only produce reconnect noise from is dropped,
  // so resolveSyncServerUrls falls through to the build-time url instead.
  it.each([
    ['the wrong protocol', 'https://sync.example.com'],
    ['not a url at all', 'sync.example.com'],
    ['not a string', 42],
  ])('drops a remote url that is %s', (_label, stored) => {
    const storage = {
      getItem: () => JSON.stringify({ remoteSyncServerUrl: stored }),
    }

    expect(readSyncSettings(storage).remoteSyncServerUrl).toBeUndefined()
  })

  it('reads the pairing token stored for a remote host', () => {
    const storage = {
      getItem: () => JSON.stringify({ pairingToken: 'guest-token' }),
    }

    expect(readSyncSettings(storage).pairingToken).toBe('guest-token')
  })

  // An empty string is what a cleared input leaves behind, and presenting it
  // is not different from presenting nothing.
  it.each([
    ['empty', ''],
    ['not a string', 42],
  ])('drops a pairing token that is %s', (_label, stored) => {
    const storage = {
      getItem: () => JSON.stringify({ pairingToken: stored }),
    }

    expect(readSyncSettings(storage).pairingToken).toBeUndefined()
  })

  it('drops a syncServerMode that is not a string', () => {
    const storage = { getItem: () => JSON.stringify({ syncServerMode: 1 }) }

    expect(readSyncSettings(storage).syncServerMode).toBeUndefined()
  })
})

describe('buildRendererNetwork', () => {
  it('builds one adapter per resolved url, local first', () => {
    const network = buildRendererNetwork({
      localUrl: 'ws://127.0.0.1:9001',
      remoteUrl: 'wss://sync.example.com',
    })

    expect(
      network.map((adapter) => (adapter as unknown as { url: string }).url),
    ).toEqual(['ws://127.0.0.1:9001', 'wss://sync.example.com'])
  })

  it('builds no adapters when no url resolved', () => {
    expect(buildRendererNetwork({})).toEqual([])
  })
})

// TAP-58: the renderer rebuilds its repo when sync settings change instead of
// reloading the window, so it needs to know which writes matter and whether a
// re-resolution actually landed somewhere new.
describe('isSyncSetting', () => {
  it('accepts every setting that feeds the resolved urls', () => {
    for (const key of [
      'syncServerMode',
      'remoteSyncServerUrl',
      'pairingToken',
      'syncServerLanEnabled',
      'syncServerHttpsEnabled',
    ]) {
      expect(isSyncSetting(key)).toBe(true)
    }
  })

  it('ignores settings that cannot move the sync server', () => {
    expect(isSyncSetting('audioFormat')).toBe(false)
    expect(isSyncSetting('storageLocation')).toBe(false)
    expect(isSyncSetting('audioInputDeviceId')).toBe(false)
  })
})

describe('sameSyncServerUrls', () => {
  it('treats an identical resolution as unchanged', () => {
    expect(
      sameSyncServerUrls(
        { localUrl: 'ws://127.0.0.1:9001', remoteUrl: undefined },
        { localUrl: 'ws://127.0.0.1:9001' },
      ),
    ).toBe(true)
  })

  it('reports a newly configured remote as a change', () => {
    expect(
      sameSyncServerUrls(
        { localUrl: 'ws://127.0.0.1:9001' },
        {
          localUrl: 'ws://127.0.0.1:9001',
          remoteUrl: 'wss://sync.example.com',
        },
      ),
    ).toBe(false)
  })

  // The embedded server restarts on wss when HTTPS is switched on, so the same
  // server at a new scheme has to count as a change.
  it('reports a changed scheme as a change', () => {
    expect(
      sameSyncServerUrls(
        { localUrl: 'ws://127.0.0.1:9001' },
        { localUrl: 'wss://127.0.0.1:9001' },
      ),
    ).toBe(false)
  })

  it('handles the pre-resolution null', () => {
    expect(sameSyncServerUrls(null, null)).toBe(true)
    expect(sameSyncServerUrls(null, { localUrl: 'ws://127.0.0.1:9001' })).toBe(
      false,
    )
  })
})

describe('sameBlobEndpoints', () => {
  it('compares by value and order', () => {
    const a = { baseUrl: 'http://127.0.0.1:9001', token: 'abc', local: true }
    const b = { baseUrl: 'https://sync.example.com', token: 'abc' }
    expect(sameBlobEndpoints([a, b], [{ ...a }, { ...b }])).toBe(true)
    expect(sameBlobEndpoints([a, b], [b, a])).toBe(false)
    expect(sameBlobEndpoints([a], [a, b])).toBe(false)
  })

  // A token change means the same host with different credentials: the repo has
  // to reconnect, so this must not read as unchanged.
  it('reports a changed token as a change', () => {
    expect(
      sameBlobEndpoints(
        [{ baseUrl: 'http://127.0.0.1:9001', token: 'abc' }],
        [{ baseUrl: 'http://127.0.0.1:9001', token: 'xyz' }],
      ),
    ).toBe(false)
  })
})

describe('rendererRepoKey', () => {
  const url = 'automerge:2PfnZbJTdgLuUuBvzuGZQiHW7cX8' as AutomergeUrl

  it('is stable for the same library and servers', () => {
    expect(rendererRepoKey(url, { localUrl: 'ws://127.0.0.1:9001' })).toBe(
      rendererRepoKey(url, { localUrl: 'ws://127.0.0.1:9001' }),
    )
  })

  it('changes when the servers change', () => {
    expect(rendererRepoKey(url, { localUrl: 'ws://127.0.0.1:9001' })).not.toBe(
      rendererRepoKey(url, {
        localUrl: 'ws://127.0.0.1:9001',
        remoteUrl: 'wss://sync.example.com',
      }),
    )
  })

  // Importing another device's library has to rebuild the repo around the new
  // document, not just re-point the existing one.
  it('changes when the library url changes', () => {
    expect(rendererRepoKey(url, { localUrl: 'ws://127.0.0.1:9001' })).not.toBe(
      rendererRepoKey(null, { localUrl: 'ws://127.0.0.1:9001' }),
    )
  })
})
