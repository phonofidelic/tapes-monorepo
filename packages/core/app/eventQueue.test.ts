import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import {
  applyIngestResponse,
  backoffDelay,
  createEvent,
  DEFAULT_MAX_QUEUED_EVENTS,
  enqueueEvent,
  flushQueue,
  getDeviceId,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  randomId,
  readQueue,
  resolveEventTarget,
  writeQueue,
  type PlaybackEvent,
} from './eventQueue'

const LOCAL = { baseUrl: 'http://127.0.0.1:9001', token: 'host', local: true }
const REMOTE = { baseUrl: 'https://studio.example', token: 'pair-token' }
const DOC = 'automerge:doc-a' as AutomergeUrl

/** A `Storage` that is nothing but a map, so tests own their own device. */
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

function event(overrides: Partial<PlaybackEvent> = {}): PlaybackEvent {
  return {
    id: 'event-1',
    recordingUrl: DOC,
    type: 'play',
    completion: 0.5,
    occurredAt: '2026-09-05T10:00:00.000Z',
    deviceId: 'device-1',
    ...overrides,
  }
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('randomId', () => {
  it('falls back to getRandomValues where randomUUID is unavailable', () => {
    // The plain-HTTP LAN mode is not a secure context, so `randomUUID` is
    // simply absent there — the case this fallback exists for.
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    })
    const id = randomId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(randomId()).not.toEqual(id)
  })
})

describe('getDeviceId', () => {
  it('mints once and keeps it across reads', () => {
    const first = getDeviceId(storage)
    expect(getDeviceId(storage)).toBe(first)
    expect(first).not.toHaveLength(0)
  })

  it('is a different device after site data is cleared', () => {
    const first = getDeviceId(storage)
    storage.clear()
    expect(getDeviceId(storage)).not.toBe(first)
  })
})

describe('resolveEventTarget', () => {
  it('prefers the remote edge, which owns the library today', () => {
    expect(resolveEventTarget(DOC, [LOCAL, REMOTE])).toBe(REMOTE)
  })

  it('falls back to this device’s own host when there is no remote', () => {
    expect(resolveEventTarget(DOC, [LOCAL])).toBe(LOCAL)
  })

  it('has no target when the device is paired with nothing', () => {
    expect(resolveEventTarget(DOC, [])).toBeUndefined()
  })
})

describe('the queue', () => {
  it('keeps one queue per edge, so an absent host does not block a present one', () => {
    enqueueEvent(storage, LOCAL, event({ id: 'local-1' }))
    enqueueEvent(storage, REMOTE, event({ id: 'remote-1' }))

    expect(readQueue(storage, LOCAL).map((e) => e.id)).toEqual(['local-1'])
    expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual(['remote-1'])
  })

  it('survives a reload: the events are read back out of storage', () => {
    enqueueEvent(storage, REMOTE, event({ id: 'a' }))
    enqueueEvent(storage, REMOTE, event({ id: 'b' }))

    // A fresh session reading the same device storage, as after a refresh.
    expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('drops the oldest at the cap rather than growing forever', () => {
    for (let index = 0; index < 5; index++) {
      enqueueEvent(storage, REMOTE, event({ id: `e${index}` }), 3)
    }
    expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual([
      'e2',
      'e3',
      'e4',
    ])
  })

  it('caps at a batch the host will accept whole', () => {
    expect(DEFAULT_MAX_QUEUED_EVENTS).toBe(500)
  })

  it('survives storage holding something that is not a queue', () => {
    storage.setItem('tapes.eventQueue', 'not json')
    expect(readQueue(storage, REMOTE)).toEqual([])
    enqueueEvent(storage, REMOTE, event({ id: 'a' }))
    expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual(['a'])
  })
})

describe('createEvent', () => {
  it('stamps the device and mints an id, carrying the measurement through', () => {
    const created = createEvent(
      {
        recordingUrl: DOC,
        completion: 0.25,
        occurredAt: '2026-09-05T10:00:00.000Z',
      },
      'device-7',
    )
    expect(created).toMatchObject({
      recordingUrl: DOC,
      type: 'play',
      completion: 0.25,
      occurredAt: '2026-09-05T10:00:00.000Z',
      deviceId: 'device-7',
    })
    expect(created.id).not.toHaveLength(0)
  })

  it('mints a fresh id per play, so the host counts both', () => {
    const session = {
      recordingUrl: DOC,
      completion: 1,
      occurredAt: '2026-09-05T10:00:00.000Z',
    }
    expect(createEvent(session, 'd').id).not.toBe(createEvent(session, 'd').id)
  })
})

describe('applyIngestResponse', () => {
  const batch = [event({ id: 'a' }), event({ id: 'b' }), event({ id: 'c' })]

  it('drops accepted and duplicates', () => {
    expect(
      applyIngestResponse(batch, {
        accepted: ['a'],
        duplicates: ['b'],
        rejected: [],
      }).map((e) => e.id),
    ).toEqual(['c'])
  })

  it('keeps a retryable rejection: the recording may not have synced yet', () => {
    expect(
      applyIngestResponse(batch, {
        accepted: ['a', 'b'],
        duplicates: [],
        rejected: [
          { index: 2, id: 'c', reason: 'unknown-recording', retryable: true },
        ],
      }).map((e) => e.id),
    ).toEqual(['c'])
  })

  it('drops a non-retryable rejection', () => {
    expect(
      applyIngestResponse(batch, {
        accepted: ['a', 'b'],
        duplicates: [],
        rejected: [
          { index: 2, id: 'c', reason: 'malformed', retryable: false },
        ],
      }),
    ).toEqual([])
  })

  it('uses the batch index for a rejection the host read no id from', () => {
    expect(
      applyIngestResponse(batch, {
        accepted: ['a', 'b'],
        duplicates: [],
        rejected: [{ index: 2, reason: 'malformed', retryable: false }],
      }),
    ).toEqual([])
  })

  it('keeps anything the answer never mentions', () => {
    expect(
      applyIngestResponse(batch, {
        accepted: ['a'],
        duplicates: [],
        rejected: [],
      }).map((e) => e.id),
    ).toEqual(['b', 'c'])
  })
})

describe('backoffDelay', () => {
  it('doubles from the first failure and stops at the ceiling', () => {
    const noJitter = () => 1
    expect(backoffDelay(1, noJitter)).toBe(INITIAL_BACKOFF_MS)
    expect(backoffDelay(2, noJitter)).toBe(INITIAL_BACKOFF_MS * 2)
    expect(backoffDelay(3, noJitter)).toBe(INITIAL_BACKOFF_MS * 4)
    expect(backoffDelay(50, noJitter)).toBe(MAX_BACKOFF_MS)
  })

  it('jitters within half the delay, so guests do not reconnect in step', () => {
    expect(backoffDelay(1, () => 0)).toBe(INITIAL_BACKOFF_MS / 2)
    expect(backoffDelay(1, () => 1)).toBe(INITIAL_BACKOFF_MS)
  })
})

describe('flushQueue', () => {
  it('sends the whole queue as one batch, bearing the pairing token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        accepted: ['a', 'b'],
        duplicates: [],
        rejected: [],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    writeQueue(storage, REMOTE, [event({ id: 'a' }), event({ id: 'b' })])

    await expect(flushQueue(storage, REMOTE)).resolves.toEqual({
      status: 'flushed',
      remaining: 0,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://studio.example/events')
    expect(init.headers.Authorization).toBe('Bearer pair-token')
    expect(
      JSON.parse(init.body).events.map((e: PlaybackEvent) => e.id),
    ).toEqual(['a', 'b'])
    expect(readQueue(storage, REMOTE)).toEqual([])
  })

  it('does not call the host when nothing is queued', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(flushQueue(storage, REMOTE)).resolves.toEqual({
      status: 'empty',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps everything when the host cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    writeQueue(storage, REMOTE, [event({ id: 'a' })])

    await expect(flushQueue(storage, REMOTE)).resolves.toEqual({
      status: 'deferred',
    })
    expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual(['a'])
  })

  it.each([401, 429, 500, 503])(
    'keeps everything on a %i, which is the host asking for later',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(status, { error: 'nope' })),
      )
      writeQueue(storage, REMOTE, [event({ id: 'a' })])

      await expect(flushQueue(storage, REMOTE)).resolves.toEqual({
        status: 'deferred',
      })
      expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual(['a'])
    },
  )

  it('keeps the retryable rejections and clears the rest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          accepted: ['a'],
          duplicates: [],
          rejected: [
            { index: 1, id: 'b', reason: 'unknown-recording', retryable: true },
          ],
        }),
      ),
    )
    writeQueue(storage, REMOTE, [event({ id: 'a' }), event({ id: 'b' })])

    await expect(flushQueue(storage, REMOTE)).resolves.toEqual({
      status: 'flushed',
      remaining: 1,
    })
    expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual(['b'])
  })

  it('keeps a play that finished while the request was in flight', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        enqueueEvent(storage, REMOTE, event({ id: 'late' }))
        return jsonResponse(200, {
          accepted: ['a'],
          duplicates: [],
          rejected: [],
        })
      }),
    )
    writeQueue(storage, REMOTE, [event({ id: 'a' })])

    await flushQueue(storage, REMOTE)
    expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual(['late'])
  })

  it('re-sends after a 200 it could not read, and the host dedupes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('truncat', { status: 200 }))
        .mockResolvedValueOnce(
          jsonResponse(200, { accepted: [], duplicates: ['a'], rejected: [] }),
        ),
    )
    writeQueue(storage, REMOTE, [event({ id: 'a' })])

    await expect(flushQueue(storage, REMOTE)).resolves.toEqual({
      status: 'deferred',
    })
    expect(readQueue(storage, REMOTE).map((e) => e.id)).toEqual(['a'])

    await flushQueue(storage, REMOTE)
    expect(readQueue(storage, REMOTE)).toEqual([])
  })

  it('drops a batch the host refuses outright rather than wedging the queue', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(415, { error: 'bad body' })),
    )
    writeQueue(storage, REMOTE, [event({ id: 'a' })])

    await expect(flushQueue(storage, REMOTE)).resolves.toEqual({
      status: 'flushed',
      remaining: 0,
    })
    expect(readQueue(storage, REMOTE)).toEqual([])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('keeps the queue when the host has no events route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { error: 'Not found' })),
    )
    writeQueue(storage, REMOTE, [event({ id: 'a' })])

    await expect(flushQueue(storage, REMOTE)).resolves.toEqual({
      status: 'deferred',
    })
    expect(readQueue(storage, REMOTE)).toHaveLength(1)
  })

  it('recovers from a stored array instead of losing every enqueue', () => {
    storage.setItem('tapes.eventQueue', '[]')
    enqueueEvent(storage, REMOTE, event({ id: 'a' }))
    expect(readQueue(storage, REMOTE)).toHaveLength(1)
  })

  it('sends no Authorization when the host is unguarded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { accepted: ['a'], duplicates: [], rejected: [] }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const unguarded = { baseUrl: 'http://127.0.0.1:9001' }
    writeQueue(storage, unguarded, [event({ id: 'a' })])

    await flushQueue(storage, unguarded)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })
})
