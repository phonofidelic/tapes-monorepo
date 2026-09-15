import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ValidIpcChanel, ValidIpcEvent } from '@tapes-monorepo/core'

/**
 * The renderer never reaches the main process directly: every request goes
 * through the bridge this module exposes, and a channel it does not recognise
 * goes nowhere. That made the allowlist load-bearing in a way nothing tested —
 * `blob:put-file` was missing from it, so a recording made on the host was
 * ingested by nobody, its document never gained a blob descriptor, and every
 * guest was told the audio was still uploading.
 *
 * `CHANNEL_ALLOWLIST` is now keyed by `ValidIpcChanel`, so a channel missing
 * from it fails `check-types` rather than any test here. What these cover is
 * what the type cannot: that an allowed channel is actually forwarded, and
 * that a rejected one fails loudly instead of being dropped.
 */

const { send, on, removeListener } = vi.hoisted(() => ({
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

let exposed: {
  send: (channel: ValidIpcChanel, data: unknown) => void
  receive: (channel: string, func: (...args: unknown[]) => void) => void
  subscribe: (
    event: ValidIpcEvent,
    func: (...args: unknown[]) => void,
  ) => () => void
}

vi.mock('electron', () => ({
  ipcRenderer: { send, on, removeListener },
  contextBridge: {
    exposeInMainWorld: (_key: string, api: typeof exposed) => {
      exposed = api
    },
  },
}))

beforeEach(async () => {
  send.mockClear()
  on.mockClear()
  removeListener.mockClear()
  vi.resetModules()
  await import('./preload')
})

describe('the ipc bridge', () => {
  // The three that were missing. Audio never crosses the wire on this
  // platform — the host ingests the file it already has on disk — so all of
  // recording, caching and pinning ride these.
  it.each<ValidIpcChanel>(['blob:put-file', 'blob:has', 'blob:cache-put'])(
    'forwards %s to the main process',
    (channel) => {
      exposed.send(channel, { data: { filepath: '/tapes/take-one.wav' } })

      expect(send).toHaveBeenCalledWith(channel, {
        data: { filepath: '/tapes/take-one.wav' },
      })
    },
  )

  it('registers a listener for an allowed response channel', () => {
    const listener = vi.fn()

    exposed.receive('blob:put-file:response:1758000000000', listener)

    expect(on).toHaveBeenCalledWith(
      'blob:put-file:response:1758000000000',
      expect.any(Function),
    )
  })

  it('hands the listener the response without the sender', () => {
    const listener = vi.fn()
    exposed.receive('blob:put-file:response:1758000000000', listener)
    const [, forward] = on.mock.calls[0] as [
      string,
      (event: unknown, ...args: unknown[]) => void,
    ]

    forward({ sender: 'the whole main-process webContents' }, { success: true })

    expect(listener).toHaveBeenCalledWith({ success: true })
  })

  // `IpcService.send` resolves only when a response arrives, so returning
  // quietly here leaves the caller awaiting a promise that never settles.
  // That is what hid the missing blob channels: the upload did not fail, it
  // simply never finished, and nothing was logged on either side.
  it('throws on an unknown channel rather than dropping the message', () => {
    expect(() =>
      exposed.send('blob:put-fil' as ValidIpcChanel, { data: {} }),
    ).toThrow(/unknown channel/)
    expect(send).not.toHaveBeenCalled()
  })

  it('throws on a response channel it did not authorise', () => {
    expect(() => exposed.receive('recorder:stop:response', vi.fn())).toThrow(
      /unknown channel/,
    )
    expect(on).not.toHaveBeenCalled()
  })

  // The patterns are anchored. Unanchored, a name only had to *contain* an
  // allowed one, so any channel could be smuggled in by prefixing it.
  it('rejects a channel that merely contains an allowed one', () => {
    expect(() =>
      exposed.receive('attacker:blob:put-file:response:1', vi.fn()),
    ).toThrow(/unknown channel/)
    expect(on).not.toHaveBeenCalled()
  })
})

/**
 * Main-process events are the other half of the bridge. They are not responses:
 * nothing asked for them, they arrive repeatedly, and they carry no
 * `:response:<timestamp>` suffix — so `receive`'s patterns reject them and they
 * need their own allowlist.
 */
describe('the ipc event bridge', () => {
  it('registers a listener for an allowed event', () => {
    const listener = vi.fn()

    exposed.subscribe('sync:connected-devices', listener)

    expect(on).toHaveBeenCalledWith(
      'sync:connected-devices',
      expect.any(Function),
    )
  })

  it('hands the listener the payload without the sender', () => {
    const listener = vi.fn()
    exposed.subscribe('sync:connected-devices', listener)
    const [, forward] = on.mock.calls[0] as [
      string,
      (event: unknown, ...args: unknown[]) => void,
    ]

    forward(
      { sender: 'the whole main-process webContents' },
      {
        connections: [],
      },
    )

    expect(listener).toHaveBeenCalledWith({ connections: [] })
  })

  // Without an unsubscribe, every remount of the panel adds another listener to
  // the same event and the renderer leaks them for the life of the window.
  it('returns an unsubscribe that removes the listener it added', () => {
    const stop = exposed.subscribe('sync:connected-devices', vi.fn())
    const [, forward] = on.mock.calls[0] as [string, () => void]

    stop()

    expect(removeListener).toHaveBeenCalledWith(
      'sync:connected-devices',
      forward,
    )
  })

  it('throws on an event it did not authorise', () => {
    expect(() =>
      exposed.subscribe('sync:everything' as ValidIpcEvent, vi.fn()),
    ).toThrow(/unknown event/)
    expect(on).not.toHaveBeenCalled()
  })

  // The two allowlists stay separate: a request channel is not something the
  // renderer may sit and listen on.
  it('throws when a request channel is subscribed to as an event', () => {
    expect(() =>
      exposed.subscribe('sync:get-connected-devices' as ValidIpcEvent, vi.fn()),
    ).toThrow(/unknown event/)
    expect(on).not.toHaveBeenCalled()
  })
})
