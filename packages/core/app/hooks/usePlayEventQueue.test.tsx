import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { BlobProvider } from './context/BlobContext'
import type { BlobEndpoint } from './blobClient'
import { readQueue, type PlaybackEvent } from './eventQueue'
import { usePlayEventQueue } from './usePlayEventQueue'

const LOCAL = { baseUrl: 'http://127.0.0.1:9001', token: 'host', local: true }
const REMOTE = { baseUrl: 'https://studio.example', token: 'pair-token' }
const DOC = 'automerge:doc-a' as AutomergeUrl

const SESSION = {
  recordingUrl: DOC,
  completion: 0.75,
  occurredAt: '2026-09-05T10:00:00.000Z',
}

function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  }
}

const okResponse = (accepted: string[] = []) =>
  new Response(JSON.stringify({ accepted, duplicates: [], rejected: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

let storage: Storage
/**
 * A play is reported through a click rather than a captured callback, so the
 * hook is only ever called the way a component calls it.
 */
function Harness({ storage }: { storage: Storage }) {
  const recordPlaySession = usePlayEventQueue({ storage })
  return (
    <button type="button" onClick={() => recordPlaySession(SESSION)}>
      finish a play
    </button>
  )
}

function mount(endpoints: readonly BlobEndpoint[]) {
  return render(
    <BlobProvider endpoints={endpoints}>
      <Harness storage={storage} />
    </BlobProvider>,
  )
}

/** One finished play. */
function play() {
  screen.getByRole('button').click()
}

beforeEach(() => {
  storage = memoryStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePlayEventQueue', () => {
  it('queues a finished play against the host that owns it', async () => {
    // The host answers nothing useful, so the event stays queued and the test
    // can see what was written rather than what was sent.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    mount([LOCAL, REMOTE])

    act(() => play())

    await waitFor(() => {
      expect(readQueue(storage, REMOTE)).toHaveLength(1)
    })
    expect(readQueue(storage, LOCAL)).toEqual([])
    const [queued] = readQueue(storage, REMOTE)
    expect(queued).toMatchObject({
      recordingUrl: DOC,
      type: 'play',
      completion: 0.75,
      occurredAt: SESSION.occurredAt,
    })
    expect(queued.deviceId).not.toHaveLength(0)
  })

  it('stamps every play on this device with the same deviceId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    mount([REMOTE])

    act(() => play())
    act(() => play())

    await waitFor(() => {
      expect(readQueue(storage, REMOTE)).toHaveLength(2)
    })
    const [first, second] = readQueue(storage, REMOTE)
    expect(second.deviceId).toBe(first.deviceId)
    expect(second.id).not.toBe(first.id)
  })

  it('drops a play when the device is paired with no host at all', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mount([])

    act(() => play())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(storage.getItem('tapes.eventQueue')).toBeNull()
  })

  it('flushes what a reload left behind, without waiting for a play', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)
    storage.setItem(
      'tapes.eventQueue',
      JSON.stringify({
        [REMOTE.baseUrl]: [
          {
            id: 'from-last-session',
            recordingUrl: DOC,
            type: 'play',
            completion: 1,
            occurredAt: SESSION.occurredAt,
            deviceId: 'device-1',
          } satisfies PlaybackEvent,
        ],
      }),
    )

    mount([REMOTE])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.events[0].id).toBe('from-last-session')
  })

  it('flushes on reconnect rather than waiting out the backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)
    mount([REMOTE])

    await act(async () => {
      play()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readQueue(storage, REMOTE)).toHaveLength(1)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('flushes a play that finishes while the start-up flush is still open', async () => {
    // The flush from mount holds the host while the play arrives. Dropping
    // that second flush would leave the play waiting for a reconnect that may
    // never come — the app is already online.
    let releaseFirst = () => {}
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseFirst = () => resolve(okResponse(['from-last-session']))
          }),
      )
      .mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)

    // Something left over from the last session, so the flush at mount is a
    // real request that can be held open.
    storage.setItem(
      'tapes.eventQueue',
      JSON.stringify({
        [REMOTE.baseUrl]: [
          {
            id: 'from-last-session',
            recordingUrl: DOC,
            type: 'play',
            completion: 1,
            occurredAt: SESSION.occurredAt,
            deviceId: 'device-1',
          } satisfies PlaybackEvent,
        ],
      }),
    )
    mount([REMOTE])
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    act(() => play())
    // Still one: the host is busy, and the play was remembered rather than sent.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseFirst()
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('sends one batch per flush, not one request per play', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)
    mount([REMOTE])

    await act(async () => {
      play()
      play()
      play()
    })
    expect(readQueue(storage, REMOTE)).toHaveLength(3)

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(okResponse())
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).events).toHaveLength(3)
  })

  it('does not leave a retry timer running after unmount', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
      vi.stubGlobal('fetch', fetchMock)
      const view = mount([REMOTE])

      await act(async () => {
        play()
      })
      fetchMock.mockClear()
      view.unmount()

      await act(async () => {
        vi.advanceTimersByTime(60_000)
      })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
