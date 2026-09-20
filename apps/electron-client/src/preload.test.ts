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

const { invoke, on, removeListener } = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

let exposed: {
  invoke: (channel: ValidIpcChanel, data: unknown) => Promise<unknown>
  subscribe: (
    event: ValidIpcEvent,
    func: (...args: unknown[]) => void,
  ) => () => void
}

vi.mock('electron', () => ({
  ipcRenderer: { invoke, on, removeListener },
  contextBridge: {
    exposeInMainWorld: (_key: string, api: typeof exposed) => {
      exposed = api
    },
  },
}))

beforeEach(async () => {
  invoke.mockClear()
  invoke.mockResolvedValue({ success: true })
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
      exposed.invoke(channel, { data: { filepath: '/tapes/take-one.wav' } })

      expect(invoke).toHaveBeenCalledWith(channel, {
        data: { filepath: '/tapes/take-one.wav' },
      })
    },
  )

  it('hands the caller the answer from the main process', async () => {
    invoke.mockResolvedValue({ success: true, data: { present: true } })

    await expect(
      exposed.invoke('blob:has', { data: { hash: 'abc' } }),
    ).resolves.toEqual({ success: true, data: { present: true } })
  })

  // The old bridge listened on a reply channel named after the request. Nothing
  // removed those listeners, so a window leaked one per request. Requests now
  // register nothing at all.
  it('registers no listener, however many requests are made', async () => {
    for (let index = 0; index < 50; index++) {
      await exposed.invoke('blob:has', { data: { hash: `hash-${index}` } })
    }

    expect(on).not.toHaveBeenCalled()
    expect(removeListener).not.toHaveBeenCalled()
  })

  // The caller holds a promise for the answer, so returning quietly here leaves
  // it awaiting a promise that never settles. That is what hid the missing blob
  // channels: the upload did not fail, it simply never finished, and nothing was
  // logged on either side.
  it('throws on an unknown channel rather than dropping the message', () => {
    expect(() =>
      exposed.invoke('blob:put-fil' as ValidIpcChanel, { data: {} }),
    ).toThrow(/unknown channel/)
    expect(invoke).not.toHaveBeenCalled()
  })

  // Reply channels were allowlisted by pattern, and a name only had to contain
  // an allowed one, so any channel could be smuggled in by prefixing it. There
  // are no reply channels now, and the allowlist is an exact match.
  it('rejects a channel that merely contains an allowed one', () => {
    expect(() =>
      exposed.invoke('attacker:blob:put-file' as ValidIpcChanel, { data: {} }),
    ).toThrow(/unknown channel/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects an event subscribed to as a request channel', () => {
    expect(() =>
      exposed.invoke('sync:connected-devices' as ValidIpcChanel, {}),
    ).toThrow(/unknown channel/)
    expect(invoke).not.toHaveBeenCalled()
  })
})

/**
 * Main-process events are the other half of the bridge, and the only half that
 * registers a listener. Nothing asked for them, they arrive repeatedly, and
 * they have their own allowlist.
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
