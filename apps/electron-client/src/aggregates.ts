import path from 'path'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import {
  DEFAULT_EVENT_MAX_AGE_MS,
  type EventStore,
  type StoredEvent,
  type SweepResult,
} from './eventStore'

/**
 * Per-recording playback numbers, derived from the event log.
 *
 * Derived, never merged. Nothing here is a counter that two peers increment:
 * every number is a fold over `eventStore`'s log, so a rollup that is lost,
 * stale or corrupt is a rebuild rather than a permanently wrong count. The
 * rollup exists only so that a read does not pay for a replay.
 *
 * The one thing that is *not* reconstructible is the baseline — see below.
 */

/** What a reader gets back. Recordings with no plays are simply absent. */
export type RecordingAggregate = {
  recordingUrl: string
  plays: number
  /**
   * Mean of the per-play completion values, 0..1.
   *
   * The mean *of the plays*, deliberately, and not total-listened over
   * `plays × duration`: the two diverge as soon as anyone replays a tape, and
   * only the per-play mean answers "did people sit through it". Keeping a sum
   * and a count rather than a running average is what makes that mean
   * foldable — two averages cannot be combined without their weights, which is
   * exactly what the baseline fold would need.
   */
  averageCompletion: number
}

/** The foldable form: a sum and a count, never a pre-divided average. */
export type Totals = {
  plays: number
  completionSum: number
}

/**
 * The frozen baseline: totals for events that no longer exist.
 *
 * Retention unlinks raw events at 90 days, but a host looking at an old tape
 * wants its *lifetime* play count — and a number that silently decreases over
 * time is worse than no number. So a segment is folded into this baseline
 * before it is unlinked, and every rollup starts from it.
 *
 * This file is therefore the only part of the analytics that cannot be
 * recomputed from anything else. It is written whole to a temp file and
 * renamed, so a crash mid-write leaves the previous version intact rather than
 * a truncated one.
 *
 * `foldedSegments` closes the window between the fold and the unlink. A
 * segment named there is already counted in `recordings`, so a replay must
 * skip it or its plays land twice, and a second fold of it must be a no-op for
 * the same reason. Names leave the list once the file behind them is gone.
 */
type BaselineFile = {
  version: 1
  updatedAt: string
  foldedSegments: string[]
  recordings: Record<string, Totals>
}

const BASELINE_FILE = 'aggregates.json'
const BASELINE_VERSION = 1

function emptyTotals(): Totals {
  return { plays: 0, completionSum: 0 }
}

/**
 * Folds one event into a recording's totals.
 *
 * Completion is clamped rather than trusted. Validating a guest's payload
 * belongs to the ingest route, which has to answer that guest about what it
 * rejected; but this reads back a log written by every earlier version of that
 * route, and a single event carrying `1e9` would otherwise poison a
 * recording's mean for as long as the baseline lives. A non-finite value still
 * counts as a play — it happened — at a completion of zero.
 */
function fold(totals: Totals, event: StoredEvent): Totals {
  const completion = Number.isFinite(event.completion)
    ? Math.min(1, Math.max(0, event.completion))
    : 0
  return {
    plays: totals.plays + 1,
    completionSum: totals.completionSum + completion,
  }
}

function add(into: Map<string, Totals>, url: string, totals: Totals) {
  const current = into.get(url) ?? emptyTotals()
  into.set(url, {
    plays: current.plays + totals.plays,
    completionSum: current.completionSum + totals.completionSum,
  })
}

/** The read shape. Zero plays cannot reach here, so the mean is always real. */
function toAggregate(recordingUrl: string, totals: Totals): RecordingAggregate {
  return {
    recordingUrl,
    plays: totals.plays,
    averageCompletion:
      totals.plays === 0 ? 0 : totals.completionSum / totals.plays,
  }
}

/**
 * Folds a stream of events onto a seed, which is how a rollup is rebuilt: the
 * frozen baseline seeds it, and the surviving log is replayed over the top.
 *
 * Takes an `AsyncIterable` rather than an array because the log is streamed —
 * 90 days of a busy library is not something to hold in memory at once.
 */
export async function deriveAggregates(
  events: AsyncIterable<StoredEvent>,
  seed: Iterable<[string, Totals]> = [],
): Promise<Map<string, Totals>> {
  const totals = new Map<string, Totals>()
  for (const [url, seeded] of seed) {
    add(totals, url, seeded)
  }
  for await (const event of events) {
    totals.set(
      event.recordingUrl,
      fold(totals.get(event.recordingUrl) ?? emptyTotals(), event),
    )
  }
  return totals
}

export type AggregateStore = ReturnType<typeof createAggregateStore>

/**
 * Aggregates over one event store, sharing its root: `aggregates.json` sits
 * beside `log/`, since the baseline is worthless without the log it continues,
 * and the log's retention is what produces the baseline in the first place.
 */
export function createAggregateStore(root: string, events: EventStore) {
  const baselinePath = path.join(root, BASELINE_FILE)
  const tmpPath = `${baselinePath}.tmp`

  let baseline = new Map<string, Totals>()
  let foldedSegments = new Set<string>()
  let rollup = new Map<string, Totals>()
  let opened = false

  async function readBaseline(): Promise<void> {
    baseline = new Map()
    foldedSegments = new Set()
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(baselinePath, 'utf-8'))
    } catch (error) {
      // A missing file is the normal first run. A corrupt one is not
      // recoverable — holding what the log no longer can was its whole point —
      // so it is reported loudly and treated as empty, which undercounts an old
      // tape rather than refusing to serve any number at all.
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error('Aggregate baseline unreadable; starting empty:', error)
      }
      return
    }
    const file = parsed as Partial<BaselineFile> | null
    if (file?.version !== BASELINE_VERSION) {
      console.error(
        `Aggregate baseline has version ${String(file?.version)}; ignoring it.`,
      )
      return
    }
    for (const [url, totals] of Object.entries(file.recordings ?? {})) {
      if (
        url.length > 0 &&
        Number.isFinite(totals?.plays) &&
        Number.isFinite(totals?.completionSum)
      ) {
        baseline.set(url, {
          plays: totals.plays,
          completionSum: totals.completionSum,
        })
      }
    }
    for (const name of file.foldedSegments ?? []) {
      if (typeof name === 'string') {
        foldedSegments.add(name)
      }
    }
  }

  /** Written whole and renamed into place, never edited where a reader sees it. */
  async function writeBaseline(): Promise<void> {
    const file: BaselineFile = {
      version: BASELINE_VERSION,
      updatedAt: new Date().toISOString(),
      foldedSegments: [...foldedSegments].sort(),
      recordings: Object.fromEntries(baseline),
    }
    await mkdir(root, { recursive: true })
    await writeFile(tmpPath, `${JSON.stringify(file, null, 2)}\n`)
    await rename(tmpPath, baselinePath)
  }

  /**
   * Rebuilds the rollup: the baseline, plus every segment the baseline has not
   * already absorbed.
   */
  async function derive(): Promise<Map<string, Totals>> {
    const names = (await events.listSegments()).filter(
      (name) => !foldedSegments.has(name),
    )
    async function* live() {
      for (const name of names) {
        yield* events.replaySegment(name)
      }
    }
    return deriveAggregates(live(), baseline)
  }

  /**
   * Loads the baseline and derives the rollup once. Every read assumes this has
   * run; answering from an unopened store would report zeros for a library
   * whose events are sitting on disk.
   */
  async function open(): Promise<number> {
    if (opened) {
      return rollup.size
    }
    await rebuild()
    return rollup.size
  }

  /** Re-reads the baseline and replays the log. The repair path. */
  async function rebuild(): Promise<number> {
    await readBaseline()
    rollup = await derive()
    opened = true
    return rollup.size
  }

  /**
   * Folds newly accepted events into the rollup, so an ingest does not pay for
   * a replay and a read straight after one is not stale.
   *
   * Only ever called with what the event store *accepted*: duplicates are
   * dropped before they reach here, which is what keeps a retried flush from
   * counting twice. Nothing is persisted — these events are in the log, and the
   * log is what the rollup derives from.
   */
  function record(accepted: StoredEvent[]): void {
    for (const event of accepted) {
      rollup.set(
        event.recordingUrl,
        fold(rollup.get(event.recordingUrl) ?? emptyTotals(), event),
      )
    }
  }

  /**
   * Retention, driven from this side because the fold has to happen first.
   *
   * The ordering is the whole point: fold the expiring segment into the
   * baseline, persist it, and only then let the store unlink the file. A crash
   * anywhere in that sequence loses nothing — the events are still on disk
   * until the last step, and `foldedSegments` keeps the replay after it from
   * counting a segment that is briefly in both places.
   */
  async function sweep(
    maxAgeMs = DEFAULT_EVENT_MAX_AGE_MS,
    now = Date.now(),
  ): Promise<SweepResult> {
    const result = await events.sweep(maxAgeMs, now, {
      onSegment: async (name, expiring) => {
        if (foldedSegments.has(name)) {
          // Already in the baseline, from a run that crashed before the unlink.
          // Folding it again would double it; the file just needs to go.
          return
        }
        for (const event of expiring) {
          baseline.set(
            event.recordingUrl,
            fold(baseline.get(event.recordingUrl) ?? emptyTotals(), event),
          )
        }
        foldedSegments.add(name)
        await writeBaseline()
      },
    })

    // The files are gone, so their names can no longer collide with a replay.
    const settled = result.segments.filter((name) => foldedSegments.has(name))
    if (settled.length > 0) {
      for (const name of settled) {
        foldedSegments.delete(name)
      }
      await writeBaseline()
    }

    return result
  }

  function get(recordingUrl: string): RecordingAggregate | undefined {
    const totals = rollup.get(recordingUrl)
    return totals ? toAggregate(recordingUrl, totals) : undefined
  }

  function all(): RecordingAggregate[] {
    return [...rollup].map(([url, totals]) => toAggregate(url, totals))
  }

  /** What the baseline alone holds, for logging and tests. */
  function frozen(): RecordingAggregate[] {
    return [...baseline].map(([url, totals]) => toAggregate(url, totals))
  }

  return { open, rebuild, record, sweep, get, all, frozen }
}
