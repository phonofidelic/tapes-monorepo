import path from 'path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAggregateStore, deriveAggregates } from './aggregates'
import {
  createEventStore,
  DEFAULT_EVENT_MAX_AGE_MS,
  type EventStore,
  type PlaybackEvent,
  type StoredEvent,
} from './eventStore'

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tapes-aggregates-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-04T12:00:00.000Z')
const RECORDING = 'automerge:recording-a'

let nextId = 0

const event = (overrides: Partial<PlaybackEvent> = {}): PlaybackEvent => ({
  id: `event-${(nextId += 1)}`,
  recordingUrl: RECORDING,
  type: 'play',
  completion: 0.5,
  occurredAt: '2026-09-04T11:59:00.000Z',
  ...overrides,
})

const stored = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
  ...event(),
  receivedAt: '2026-09-04T12:00:00.000Z',
  ...overrides,
})

async function* streamOf(events: StoredEvent[]) {
  yield* events
}

const baselineFile = () => path.join(root, 'aggregates.json')

const readBaselineFile = async () =>
  JSON.parse(await readFile(baselineFile(), 'utf-8'))

async function openStores() {
  const events = createEventStore(root)
  await events.open()
  const aggregates = createAggregateStore(root, events)
  await aggregates.open()
  return { events, aggregates }
}

/** Reopens against the same directory, as a restart would. */
async function reopen() {
  return openStores()
}

describe('deriveAggregates', () => {
  it('counts plays and averages completion per recording', async () => {
    const totals = await deriveAggregates(
      streamOf([
        stored({ recordingUrl: 'a', completion: 0.2 }),
        stored({ recordingUrl: 'a', completion: 0.8 }),
        stored({ recordingUrl: 'b', completion: 1 }),
      ]),
    )

    expect(totals.get('a')).toEqual({ plays: 2, completionSum: 1 })
    expect(totals.get('b')).toEqual({ plays: 1, completionSum: 1 })
  })

  it('folds onto a seed, so a baseline continues into the live log', async () => {
    const totals = await deriveAggregates(
      streamOf([stored({ completion: 1 })]),
      [[RECORDING, { plays: 3, completionSum: 1.5 }]],
    )

    expect(totals.get(RECORDING)).toEqual({ plays: 4, completionSum: 2.5 })
  })
})

describe('reads', () => {
  it('averages the plays, not the listened time over the total duration', async () => {
    const { events, aggregates } = await openStores()

    // The same tape played through once and then abandoned at a tenth. Total
    // listened over (plays x duration) would say 0.55; what a host asked "did
    // people sit through it" wants is the mean of the two plays.
    const { accepted } = await events.append(
      [event({ completion: 1 }), event({ completion: 0.1 })],
      NOW,
    )
    aggregates.record(accepted)

    expect(aggregates.get(RECORDING)).toEqual({
      recordingUrl: RECORDING,
      plays: 2,
      averageCompletion: 0.55,
    })
  })

  it('separates recordings and omits ones with no plays', async () => {
    const { events, aggregates } = await openStores()
    const { accepted } = await events.append(
      [
        event({ recordingUrl: 'a', completion: 1 }),
        event({ recordingUrl: 'b', completion: 0.25 }),
      ],
      NOW,
    )
    aggregates.record(accepted)

    expect(aggregates.all()).toEqual([
      { recordingUrl: 'a', plays: 1, averageCompletion: 1 },
      { recordingUrl: 'b', plays: 1, averageCompletion: 0.25 },
    ])
    expect(aggregates.get('never-played')).toBeUndefined()
  })

  it('does not count an event the store rejected as a duplicate', async () => {
    const { events, aggregates } = await openStores()

    const first = await events.append([event({ id: 'dupe' })], NOW)
    aggregates.record(first.accepted)
    // The flush the client retried after a lost response.
    const retry = await events.append([event({ id: 'dupe' })], NOW)
    aggregates.record(retry.accepted)

    expect(retry.duplicates).toEqual(['dupe'])
    expect(aggregates.get(RECORDING)?.plays).toBe(1)
  })

  it('clamps a completion outside 0..1 rather than letting it skew the mean', async () => {
    const { events, aggregates } = await openStores()
    const { accepted } = await events.append(
      [event({ completion: 1e9 }), event({ completion: -4 })],
      NOW,
    )
    aggregates.record(accepted)

    expect(aggregates.get(RECORDING)).toEqual({
      recordingUrl: RECORDING,
      plays: 2,
      averageCompletion: 0.5,
    })
  })
})

describe('rebuild', () => {
  it('derives the same numbers from the log alone, with no rollup in hand', async () => {
    const { events } = await openStores()
    await events.append(
      [event({ completion: 1 }), event({ completion: 0 })],
      NOW,
    )

    // A fresh store has recorded nothing incrementally; everything it knows
    // comes from replaying what is on disk.
    const { aggregates } = await reopen()

    expect(aggregates.get(RECORDING)).toEqual({
      recordingUrl: RECORDING,
      plays: 2,
      averageCompletion: 0.5,
    })
  })

  it('replays the log over several day segments in order', async () => {
    const { events } = await openStores()
    await events.append([event({ completion: 1 })], NOW - 2 * DAY_MS)
    await events.append([event({ completion: 0.5 })], NOW - DAY_MS)
    await events.append([event({ completion: 0 })], NOW)

    const { aggregates } = await reopen()

    expect(aggregates.get(RECORDING)).toEqual({
      recordingUrl: RECORDING,
      plays: 3,
      averageCompletion: 0.5,
    })
  })

  it('recovers from a corrupt baseline instead of refusing to serve numbers', async () => {
    const { events } = await openStores()
    await events.append([event({ completion: 1 })], NOW)
    await writeFile(baselineFile(), '{ not json')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { aggregates } = await reopen()

    // The baseline's own contents are gone for good — that is what makes it the
    // one thing worth writing atomically — but the surviving log still counts.
    expect(aggregates.get(RECORDING)?.plays).toBe(1)
  })

  it('repairs a rollup that drifted, on demand', async () => {
    const { events, aggregates } = await openStores()
    const { accepted } = await events.append([event()], NOW)
    // A caller that double-recorded the same accepted batch.
    aggregates.record(accepted)
    aggregates.record(accepted)
    expect(aggregates.get(RECORDING)?.plays).toBe(2)

    await aggregates.rebuild()

    expect(aggregates.get(RECORDING)?.plays).toBe(1)
  })
})

describe('retention', () => {
  it('keeps expired plays in the totals by folding them into the baseline', async () => {
    const { events, aggregates } = await openStores()
    await events.append([event({ completion: 1 })], NOW - 95 * DAY_MS)
    await events.append([event({ completion: 0 })], NOW)
    await aggregates.rebuild()

    const result = await aggregates.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    // The raw event is gone...
    expect(result.events).toBe(1)
    expect(await drain(events.replay())).toHaveLength(1)
    // ...but the play it contributed is not.
    expect(aggregates.get(RECORDING)).toEqual({
      recordingUrl: RECORDING,
      plays: 2,
      averageCompletion: 0.5,
    })
    expect(aggregates.frozen()).toEqual([
      { recordingUrl: RECORDING, plays: 1, averageCompletion: 1 },
    ])
  })

  it('still has the lifetime count after a restart, with the events long gone', async () => {
    const { events, aggregates } = await openStores()
    await events.append([event({ completion: 1 })], NOW - 95 * DAY_MS)
    await aggregates.rebuild()
    await aggregates.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    const restarted = await reopen()

    expect(restarted.aggregates.get(RECORDING)).toEqual({
      recordingUrl: RECORDING,
      plays: 1,
      averageCompletion: 1,
    })
  })

  it('does not count a folded segment twice when the unlink never happened', async () => {
    const { events, aggregates } = await openStores()
    await events.append([event({ completion: 1 })], NOW - 95 * DAY_MS)
    await aggregates.rebuild()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Persisted into the baseline, then the process died before the `rm`: the
    // segment is on disk *and* in the baseline at the same time.
    const crashing = crashAfterBaseline(events)
    await expect(
      createAggregateStore(root, crashing).sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW),
    ).resolves.toBeDefined()
    expect(await drain(events.replay())).toHaveLength(1)
    expect((await readBaselineFile()).foldedSegments).toEqual([
      '2026-06-01.ndjson',
    ])

    const restarted = await reopen()

    // Replay skips what the baseline already absorbed.
    expect(restarted.aggregates.get(RECORDING)?.plays).toBe(1)

    // And the sweep that finally unlinks it does not fold it a second time.
    await restarted.aggregates.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)
    expect(restarted.aggregates.get(RECORDING)?.plays).toBe(1)
    expect(await drain(restarted.events.replay())).toHaveLength(0)
    expect((await readBaselineFile()).foldedSegments).toEqual([])
  })

  it('keeps the events when the baseline cannot be written', async () => {
    const { events, aggregates } = await openStores()
    await events.append([event({ completion: 1 })], NOW - 95 * DAY_MS)
    await aggregates.rebuild()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // A directory sitting where the baseline file goes, so the rename that
    // publishes it cannot land.
    await rm(baselineFile(), { force: true })
    await mkdir(baselineFile(), { recursive: true })

    const result = await aggregates.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    // Deleting the events after failing to freeze them would lose the plays
    // from both places at once; a day of extra retention is the cheaper miss.
    expect(result.segments).toEqual([])
    expect(result.retained).toHaveLength(1)
    expect(await drain(events.replay())).toHaveLength(1)
  })

  it('leaves the baseline alone when nothing is old enough to sweep', async () => {
    const { events, aggregates } = await openStores()
    await events.append([event()], NOW)
    await aggregates.rebuild()

    const result = await aggregates.sweep(DEFAULT_EVENT_MAX_AGE_MS, NOW)

    expect(result).toEqual({ segments: [], events: 0, retained: [] })
    expect(aggregates.frozen()).toEqual([])
  })
})

/**
 * An event store whose sweep folds the segment and then stops short of the
 * unlink, standing in for a process that died in that window.
 */
function crashAfterBaseline(events: EventStore): EventStore {
  return {
    ...events,
    sweep: async (_maxAgeMs, _now, options) => {
      for (const name of await events.listSegments()) {
        const expiring = await drain(events.replaySegment(name))
        await options?.onSegment?.(name, expiring)
      }
      return { segments: [], events: 0, retained: [] }
    },
  }
}

async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of source) {
    items.push(item)
  }
  return items
}
