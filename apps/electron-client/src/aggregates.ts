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
 * Nothing here is a counter that two peers increment. Every number is a fold
 * over the event log, so a lost or corrupt rollup is rebuilt, not wrong. The
 * rollup exists only so a read does not pay for a replay. The one exception
 * is the frozen baseline, which holds totals for events retention has already
 * deleted. See `BaselineFile`.
 */

/** What a reader gets back. Recordings with no plays are simply absent. */
export type RecordingAggregate = {
  recordingUrl: string
  plays: number
  /**
   * Mean of the per-play completion values, 0..1.
   *
   * This is the mean of the plays, not total listened time over plays times
   * duration. The two diverge once anyone replays a tape, and only the per-play
   * mean answers whether people sat through it.
   */
  averageCompletion: number
}

/**
 * The foldable form: a sum and a count, never a pre-divided average. Two
 * averages cannot be combined without their weights, and the baseline fold
 * needs to combine them.
 */
export type Totals = {
  plays: number
  completionSum: number
}

/**
 * The frozen baseline: totals for events retention has deleted.
 *
 * Raw events go at 90 days, but a lifetime play count must never decrease. So
 * a segment is folded in here before it is unlinked, and every rollup starts
 * from it. This is the only analytics file that cannot be recomputed.
 * `foldedSegments` names segments already counted but not yet unlinked, so a
 * replay skips them and a second fold is a no-op.
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
 * Completion is clamped rather than trusted. The ingest route validates new
 * payloads, but this reads a log written by every earlier version of it, and
 * one event carrying `1e9` would poison a mean for as long as the baseline
 * lives. A non-finite value still counts as a play, at completion zero.
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
 * Folds a stream of events onto a seed. The frozen baseline seeds a rebuild
 * and the surviving log is replayed over it. Takes an `AsyncIterable` because
 * 90 days of a busy library should not be held in memory at once.
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
 * Aggregates over one event store, sharing its root. The baseline file sits
 * beside the log directory because it is worthless without the log it
 * continues, and the log's retention is what produces it.
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
      // A missing file is the normal first run. A corrupt one cannot be
      // recovered, so it is reported loudly and treated as empty. That
      // undercounts an old tape rather than refusing to serve any number.
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

  // Written whole to a temp file and renamed into place, so a crash mid-write
  // leaves the previous version intact rather than a truncated one.
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
   * Loads the baseline and derives the rollup once. Every read assumes this
   * has run, or a library with events on disk would report zeros.
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
   * Only called with what the event store accepted. Duplicates are dropped
   * before this, which keeps a retried flush from counting twice. Nothing is
   * persisted here, because the log is what the rollup derives from.
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
   * Fold the expiring segment into the baseline, persist it, then let the
   * store unlink the file. A crash anywhere loses nothing: the events stay on
   * disk until the last step, and `foldedSegments` keeps a replay from
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
