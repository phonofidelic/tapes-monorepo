import { describe, it, expect, vi } from 'vitest'
import type { SyncServerInfo } from '@tapes-monorepo/core'
import {
  buildRendererNetwork,
  readSyncSettings,
  resolveSyncServerUrls,
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
      // The remote is someone else's server and never sees this token.
      remoteUrl: 'wss://sync.example.com',
    })
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
