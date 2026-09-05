import { describe, expect, it } from 'vitest'
import { resolveEventTarget, sameEventTarget } from './eventTarget'

const TOKEN = 'pairing-token'

describe('resolveEventTarget', () => {
  it('reads its own embedded host in-process', () => {
    expect(
      resolveEventTarget({
        syncServerInfo: {
          blobBaseUrl: 'http://127.0.0.1:9001',
          pairingToken: TOKEN,
        },
      }),
    ).toEqual({ kind: 'ipc' })
  })

  // A desktop app in remote sync mode still runs its own host. Answering from
  // it is always possible and almost always wrong.
  it('prefers the remote edge over its own embedded host', () => {
    expect(
      resolveEventTarget({
        syncServerInfo: {
          blobBaseUrl: 'http://127.0.0.1:9001',
          pairingToken: 'our-own-token',
        },
        remoteSyncServerUrl: 'wss://studio.local:9001/sync',
        token: TOKEN,
      }),
    ).toEqual({
      kind: 'http',
      baseUrl: 'https://studio.local:9001',
      token: TOKEN,
    })
  })

  // Without a token every request to that server would be rejected.
  it('falls back to its own host when the remote edge is unpaired', () => {
    expect(
      resolveEventTarget({
        syncServerInfo: {
          blobBaseUrl: 'http://127.0.0.1:9001',
          pairingToken: 'our-own-token',
        },
        remoteSyncServerUrl: 'wss://studio.local:9001/sync',
      }),
    ).toEqual({ kind: 'ipc' })
  })

  it('uses the page origin for a guest served by the host', () => {
    expect(
      resolveEventTarget({
        origin: 'https://192.168.1.20:9001/',
        servedByHost: true,
        token: TOKEN,
      }),
    ).toEqual({
      kind: 'http',
      baseUrl: 'https://192.168.1.20:9001',
      token: TOKEN,
    })
  })

  it('derives an http origin from the sync socket url', () => {
    expect(
      resolveEventTarget({
        remoteSyncServerUrl: 'ws://192.168.1.20:9001/sync',
        token: TOKEN,
      }),
    ).toEqual({
      kind: 'http',
      baseUrl: 'http://192.168.1.20:9001',
      token: TOKEN,
    })
  })

  // Paired with nothing, so there is no host to read from.
  it('resolves nothing for a standalone web client', () => {
    expect(
      resolveEventTarget({ origin: 'https://tapes.example.com' }),
    ).toBeUndefined()
  })

  it('ignores a sync url that is not a websocket url', () => {
    expect(
      resolveEventTarget({
        remoteSyncServerUrl: 'https://studio.local:9001/sync',
        token: TOKEN,
      }),
    ).toBeUndefined()
  })
})

describe('sameEventTarget', () => {
  it('treats an unchanged resolution as the same host', () => {
    expect(
      sameEventTarget(
        { kind: 'http', baseUrl: 'https://a.local', token: TOKEN },
        { kind: 'http', baseUrl: 'https://a.local', token: TOKEN },
      ),
    ).toBe(true)
    expect(sameEventTarget({ kind: 'ipc' }, { kind: 'ipc' })).toBe(true)
    expect(sameEventTarget(undefined, undefined)).toBe(true)
  })

  // Re-pairing counts as a different host. The old entity tag means nothing
  // to the new one.
  it('separates hosts that differ by origin, token or kind', () => {
    expect(
      sameEventTarget(
        { kind: 'http', baseUrl: 'https://a.local', token: TOKEN },
        { kind: 'http', baseUrl: 'https://b.local', token: TOKEN },
      ),
    ).toBe(false)
    expect(
      sameEventTarget(
        { kind: 'http', baseUrl: 'https://a.local', token: TOKEN },
        { kind: 'http', baseUrl: 'https://a.local', token: 'other' },
      ),
    ).toBe(false)
    expect(
      sameEventTarget({ kind: 'ipc' }, { kind: 'http', baseUrl: 'https://a' }),
    ).toBe(false)
    expect(sameEventTarget({ kind: 'ipc' }, undefined)).toBe(false)
  })
})
