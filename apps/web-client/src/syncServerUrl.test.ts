import { describe, it, expect } from 'vitest'
import {
  resolveSyncServerUrl,
  type SyncUrlEnv,
  type SyncUrlLocation,
} from './syncServerUrl'

const HTTP: SyncUrlLocation = { protocol: 'http:', host: 'lan-host:3000' }
const HTTPS: SyncUrlLocation = { protocol: 'https:', host: 'lan-host:3000' }

function storageWith(settings?: string): Pick<Storage, 'getItem'> {
  return { getItem: (key) => (key === 'settings' ? (settings ?? null) : null) }
}

function resolve({
  env = {},
  location = HTTP,
  settings,
  token,
}: {
  env?: SyncUrlEnv
  location?: SyncUrlLocation
  settings?: string
  token?: string
} = {}) {
  return resolveSyncServerUrl({
    env,
    location,
    storage: storageWith(settings),
    token,
  })
}

describe('resolveSyncServerUrl', () => {
  it('prefers the build-time env var over every other source', () => {
    expect(
      resolve({
        env: { VITE_SYNC_SERVER_URL: 'wss://sync.example.com', DEV: true },
        settings: JSON.stringify({ remoteSyncServerUrl: 'ws://stored:1234' }),
      }),
    ).toBe('wss://sync.example.com')
  })

  it('falls back to a remote server the user configured in Settings', () => {
    expect(
      resolve({
        settings: JSON.stringify({ remoteSyncServerUrl: 'ws://stored:1234' }),
      }),
    ).toBe('ws://stored:1234')
  })

  it('prefers the stored URL over same-origin /sync', () => {
    expect(
      resolve({
        env: { DEV: true },
        settings: JSON.stringify({ remoteSyncServerUrl: 'wss://stored:1234' }),
      }),
    ).toBe('wss://stored:1234')
  })

  // A value Automerge could only fail to connect to must not win the chain.
  it.each([
    ['a non-websocket protocol', JSON.stringify({ remoteSyncServerUrl: 'https://nope' })],
    ['an unparseable URL', JSON.stringify({ remoteSyncServerUrl: 'not a url' })],
    ['a non-string value', JSON.stringify({ remoteSyncServerUrl: 1234 })],
    ['an absent key', JSON.stringify({ audioFormat: 'wav' })],
    ['malformed settings JSON', '{ not json'],
    ['a non-object settings blob', '"just a string"'],
  ])('ignores a stored URL with %s', (_case, settings) => {
    expect(resolve({ settings })).toBeUndefined()
    // ...and still falls through to the next rung rather than short-circuiting.
    expect(resolve({ env: { DEV: true }, settings })).toBe(
      'ws://lan-host:3000/sync',
    )
  })

  it('uses same-origin /sync when served by the dev server', () => {
    expect(resolve({ env: { DEV: true } })).toBe('ws://lan-host:3000/sync')
  })

  it('uses same-origin /sync when the Electron host serves the bundle', () => {
    expect(resolve({ env: { VITE_SERVED_BY_HOST: 'true' } })).toBe(
      'ws://lan-host:3000/sync',
    )
  })

  it('upgrades the scheme to wss on an https origin', () => {
    expect(resolve({ env: { DEV: true }, location: HTTPS })).toBe(
      'wss://lan-host:3000/sync',
    )
    expect(
      resolve({ env: { VITE_SERVED_BY_HOST: 'true' }, location: HTTPS }),
    ).toBe('wss://lan-host:3000/sync')
  })

  it('runs local-only for a standalone static deploy', () => {
    expect(resolve()).toBeUndefined()
  })

  it('treats a host flag that is not "true" as standalone', () => {
    expect(resolve({ env: { VITE_SERVED_BY_HOST: 'false' } })).toBeUndefined()
  })

  // The host verifies this on the upgrade and a WebSocket cannot carry a
  // header, so a paired guest has to put it in the query or be refused.
  it('carries the pairing token on the same-origin socket', () => {
    expect(resolve({ env: { DEV: true }, token: 'a token/+' })).toBe(
      'ws://lan-host:3000/sync?t=a%20token%2F%2B',
    )
  })

  // A remote or build-time server is a different deployment with a different
  // secret; sending this host's token there would only leak it.
  it('does not send the pairing token to a remote server', () => {
    expect(
      resolve({
        env: { VITE_SYNC_SERVER_URL: 'wss://sync.example.com' },
        token: 'host-token',
      }),
    ).toBe('wss://sync.example.com')

    expect(
      resolve({
        settings: JSON.stringify({ remoteSyncServerUrl: 'ws://stored:1234' }),
        token: 'host-token',
      }),
    ).toBe('ws://stored:1234')
  })
})
