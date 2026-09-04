import path from 'path'
import { mkdtemp, appendFile, mkdir, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEventStore,
  DEFAULT_EVENT_MAX_AGE_MS,
  type PlaybackEvent,
} from './eventStore'

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tapes-events-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-04T12:00:00.000Z')

const event = (overrides: Partial<PlaybackEvent> = {}): PlaybackEvent => ({
  id: 'event-1',
  recordingUrl: 'automerge:recording-a',
  type: 'play',
  completion: 0.5,
  occurredAt: '2026-09-04T11:59:00.000Z',
  ...overrides,
})

const logDir = () => path.join(root, 'log')

const readSegment = (name: string) =>
  readFile(path.join(logDir(), name), 'utf-8')

async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of source) {
    items.push(item)
  }
  return items
}

async function openStore() {
  const store = createEventStore(root)
  await store.open()
  return store
}

describe('append', () => {
  it('writes a batch as one line per event, in a segment named for the day', async () => {
    const store = await openStore()

    const result = await store.append(
      [event({ id: 'a' }), event({ id: 'b', completion: 1 })],
      NOW,
    )

    expect(result.accepted.map((e) => e.id)).toEqual(['a', 'b'])
    expect(result.duplicates).toEqual([])
    expect(await readdir(logDir())).toEqual(['2026-09-04.ndjson'])
    const lines = (await readSegment('2026-09-04.ndjson')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1])).toMatchObject({ id: 'b', completion: 1 })
  })

  it('stamps the host clock rather than trusting the guest clock', async () => {
    const store = await openStore()

    const { accepted } = await store.append(
      [event({ occurredAt: '2031-01-01T00:00:00.000Z' })],
      NOW,
    )

    expect(accepted[0].receivedAt).toBe('2026-09-04T12:00:00.000Z')
    expect(accepted[0].occurredAt).toBe('2031-01-01T00:00:00.000Z')
  })

  it('appends to the existing segment instead of replacing it', async () => {
    const store = await openStore()

    await store.append([event({ id: 'a' })], NOW)
    await store.append([event({ id: 'b' })], NOW + 1000)

    expect(await readdir(logDir())).toEqual(['2026-09-04.ndjson'])
    expect((await drain(store.replay())).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('drops an id already in the log and reports it as a duplicate', async () => {
    const store = await openStore()
    await store.append([event({ id: 'a' })], NOW)

    const result = await store.append(
      [event({ id: 'a' }), event({ id: 'b' })],
      NOW,
    )

    expect(result.accepted.map((e) => e.id)).toEqual(['b'])
    expect(result.duplicates).toEqual(['a'])
    expect((await drain(store.replay())).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('deduplicates within a single batch', async () => {
    const store = await openStore()

    const result = await store.append(
      [event({ id: 'a' }), event({ id: 'a' })],
      NOW,
    )

    expect(result.accepted).toHaveLength(1)
    expect(result.duplicates).toEqual(['a'])
  })

  it('ignores an event with no id, which could never be deduped', async () => {
    const store = await openStore()

    const result = await store.append([event({ id: '' })], NOW)

    expect(result.accepted).toEqual([])
    expect(await drain(store.replay())).toEqual([])
  })

  it('writes nothing when every event in the batch is a duplicate', async () => {
    const store = await openStore()
    await store.append([event({ id: 'a' })], NOW)

    await store.append([event({ id: 'a' })], NOW + DAY_MS)

    // No segment for the second day: an all-duplicate flush touches no file.
    expect(await readdir(logDir())).toEqual(['2026-09-04.ndjson'])
  })

  it('takes the same id from two different devices', async () => {
    const store = await openStore()

    const result = await store.append(
      [
        event({ id: 'event-1', deviceId: 'phone' }),
        event({ id: 'event-1', deviceId: 'laptop' }),
      ],
      NOW,
    )

    // Nothing forces a guest to mint a UUID; two devices on the same naive
    // scheme must not have one swallow the other's plays.
    expect(result.accepted).toHaveLength(2)
    expect(result.duplicates).toEqual([])
  })

  it('still deduplicates a repeat from the same device', async () => {
    const store = await openStore()
    await store.append([event({ id: 'event-1', deviceId: 'phone' })], NOW)

    const result = await store.append(
      [event({ id: 'event-1', deviceId: 'phone' })],
      NOW,
    )

    expect(result.accepted).toEqual([])
    expect(result.duplicates).toEqual(['event-1'])
  })

  it('does not let a device id collide with another device plus an id', async () => {
    const store = await openStore()

    const result = await store.append(
      [
        event({ id: 'b', deviceId: 'a' }),
        event({ id: 'ab', deviceId: undefined }),
        event({ id: '', deviceId: 'ab' }),
      ],
      NOW,
    )

    // 'a' + 'b' must not key the same as 'ab'; the empty id is dropped
    // outright, as it could never be deduped at all.
    expect(result.accepted.map((e) => e.id)).toEqual(['b', 'ab'])
    expect(result.duplicates).toEqual([])
  })

  it('keeps concurrent batches from interleaving their lines', async () => {
    const store = await openStore()

    await Promise.all([
      store.append([event({ id: 'a1' }), event({ id: 'a2' })], NOW),
      store.append([event({ id: 'b1' }), event({ id: 'b2' })], NOW),
    ])

    const ids = (await drain(store.replay())).map((e) => e.id)
    expect(ids).toHaveLength(4)
    expect(Math.abs(ids.indexOf('a1') - ids.indexOf('a2'))).toBe(1)
    expect(Math.abs(ids.indexOf('b1') - ids.indexOf('b2'))).toBe(1)
  })
})

describe('durability', () => {
  it('rebuilds the dedupe index from disk, so a restart cannot double-count', async () => {
    const first = await openStore()
    await first.append([event({ id: 'a' }), event({ id: 'b' })], NOW)

    const second = await openStore()

    expect(second.size()).toBe(2)
    expect(second.has({ id: 'a' })).toBe(true)
    const result = await second.append([event({ id: 'a' })], NOW)
    expect(result.accepted).toEqual([])
    expect(result.duplicates).toEqual(['a'])
  })

  it('rebuilds the index with device scoping intact', async () => {
    const first = await openStore()
    await first.append([event({ id: 'event-1', deviceId: 'phone' })], NOW)

    const second = await openStore()

    expect(second.has({ id: 'event-1', deviceId: 'phone' })).toBe(true)
    expect(second.has({ id: 'event-1', deviceId: 'laptop' })).toBe(false)
    const result = await second.append(
      [event({ id: 'event-1', deviceId: 'laptop' })],
      NOW,
    )
    expect(result.accepted).toHaveLength(1)
  })

  it('replays every segment in chronological order', async () => {
    const store = await openStore()
    await store.append([event({ id: 'old' })], NOW - 3 * DAY_MS)
    await store.append([event({ id: 'mid' })], NOW - DAY_MS)
    await store.append([event({ id: 'new' })], NOW)

    expect((await drain(store.replay())).map((e) => e.id)).toEqual([
      'old',
      'mid',
      'new',
    ])
  })

  it('skips the torn last line an unclean quit leaves behind', async () => {
    const store = await openStore()
    await store.append([event({ id: 'a' })], NOW)
    // A write the process did not finish.
    await appendFile(path.join(logDir(), '2026-09-04.ndjson'), '{"id":"b","re')

    const reopened = await openStore()

    expect((await drain(reopened.replay())).map((e) => e.id)).toEqual(['a'])
    expect(reopened.has({ id: 'b' })).toBe(false)
    // The good line before it is still readable, and still appendable after.
    const result = await reopened.append([event({ id: 'c' })], NOW)
    expect(result.accepted.map((e) => e.id)).toEqual(['c'])
  })

  it('skips a line that parses but is not an event', async () => {
    await mkdir(logDir(), { recursive: true })
    await appendFile(
      path.join(logDir(), '2026-09-04.ndjson'),
      `${JSON.stringify({ id: 'junk' })}\n${JSON.stringify({
        id: 'good',
        recordingUrl: 'automerge:recording-a',
        type: 'play',
        completion: 0.25,
        occurredAt: '2026-09-04T11:00:00.000Z',
        receivedAt: '2026-09-04T11:00:01.000Z',
      })}\n`,
    )

    const store = await openStore()

    expect((await drain(store.replay())).map((e) => e.id)).toEqual(['good'])
  })

  it('opens an empty store without a log directory on disk', async () => {
    const store = createEventStore(path.join(root, 'nothing-here'))

    expect(await store.open()).toBe(0)
    expect(await drain(store.replay())).toEqual([])
  })
})

describe('sweep', () => {
  it('unlinks segments whose events are all past the retention window', async () => {
    const store = await openStore()
    await store.append([event({ id: 'ancient' })], NOW - 200 * DAY_MS)
    await store.append([event({ id: 'stale' })], NOW - 95 * DAY_MS)
    await store.append([event({ id: 'fresh' })], NOW)

    const result = await store.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    expect(result.segments).toHaveLength(2)
    expect(result.events).toBe(2)
    expect((await drain(store.replay())).map((e) => e.id)).toEqual(['fresh'])
  })

  it('keeps a segment that still holds events inside the window', async () => {
    const store = await openStore()
    // Same UTC day as the cutoff: its later events are still within 90 days.
    await store.append([event({ id: 'edge' })], NOW - 90 * DAY_MS)

    const result = await store.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    expect(result.segments).toEqual([])
    expect((await drain(store.replay())).map((e) => e.id)).toEqual(['edge'])
  })

  it('forgets swept ids so the dedupe index does not grow forever', async () => {
    const store = await openStore()
    await store.append([event({ id: 'stale' })], NOW - 95 * DAY_MS)
    await store.append([event({ id: 'fresh' })], NOW)
    expect(store.size()).toBe(2)

    await store.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    expect(store.size()).toBe(1)
    expect(store.has({ id: 'stale' })).toBe(false)
    expect(store.has({ id: 'fresh' })).toBe(true)
  })

  it('forgets a swept device+id pair, not every event sharing that id', async () => {
    const store = await openStore()
    await store.append(
      [event({ id: 'event-1', deviceId: 'phone' })],
      NOW - 95 * DAY_MS,
    )
    await store.append([event({ id: 'event-1', deviceId: 'laptop' })], NOW)

    await store.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    expect(store.has({ id: 'event-1', deviceId: 'phone' })).toBe(false)
    expect(store.has({ id: 'event-1', deviceId: 'laptop' })).toBe(true)
  })

  it('leaves files that are not segments alone', async () => {
    const store = await openStore()
    await store.append([event({ id: 'fresh' })], NOW)
    await appendFile(path.join(logDir(), 'notes.txt'), 'not a segment')

    await store.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    expect((await readdir(logDir())).sort()).toEqual([
      '2026-09-04.ndjson',
      'notes.txt',
    ])
  })

  it('is a no-op on an empty store', async () => {
    const store = await openStore()

    expect(await store.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)).toEqual({
      segments: [],
      events: 0,
      retained: [],
    })
  })
})
