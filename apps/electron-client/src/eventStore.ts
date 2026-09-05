import path from 'path'
import { createReadStream } from 'fs'
import { appendFile, mkdir, readdir, rm } from 'fs/promises'
import { createInterface } from 'readline'

/**
 * A durable, append-only log of playback events, owned by the sync host.
 *
 * Aggregates are derived from this log, never kept as merged counters. Two
 * peers cannot repair a counter they both incremented, but a log can be
 * replayed. Every write appends to a day segment, no file is ever rewritten,
 * and retention unlinks whole segments.
 * Do not import `electron` here. Path resolution lives in `syncServerConfig`,
 * so this can be tested in a plain node process.
 */

/** Raw events are kept for 90 days; the aggregates derived from them are not. */
export const DEFAULT_EVENT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

const SEGMENT_EXTENSION = '.ndjson'
const SEGMENT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.ndjson$/
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * One playback of one recording, as reported by a guest.
 *
 * `id` is minted by the client. It is what makes a retried flush safe: without
 * it, a batch resent after a lost response would double every count in it.
 */
export type PlaybackEvent = {
  id: string
  /** Automerge url of the recording that was played. */
  recordingUrl: string
  type: 'play'
  /** Furthest point reached, as a fraction of the recording's duration. */
  completion: number
  /** Guest's clock, kept for display; never used for retention. See below. */
  occurredAt: string
  /** Which guest reported it, for a per-device breakdown later. */
  deviceId?: string
}

export type StoredEvent = PlaybackEvent & {
  /**
   * Host clock, stamped on acceptance. Retention keys on this, not on
   * `occurredAt`. A guest clock running years fast would otherwise hold its
   * events past every sweep. One running years slow would have them collected
   * before they were ever counted.
   */
  receivedAt: string
}

export type AppendResult = {
  /** Events written, in the order they were given. */
  accepted: StoredEvent[]
  /**
   * Ids this device had already sent. The caller may clear them from its
   * queue. Bare ids, not dedupe keys, because a client only knows its own.
   */
  duplicates: string[]
}

export type SweepResult = {
  /** Day segments unlinked whole. */
  segments: string[]
  /** Events those segments held. */
  events: number
  /**
   * Segments past retention that were left in place because `onSegment` threw.
   * They are swept on a later pass.
   */
  retained: string[]
}

export type SweepOptions = {
  /**
   * Called with a segment's events just before it is unlinked, so the frozen
   * aggregate baseline in `aggregates.ts` can absorb them first.
   *
   * Throwing keeps the segment. The hook did not persist what it derived, and
   * deleting the events now would lose them from both places. Retention
   * slipping by a day is the cheaper failure.
   */
  onSegment?: (name: string, events: StoredEvent[]) => Promise<void>
}

export type EventStore = ReturnType<typeof createEventStore>

/** UTC day key, so a segment name means the same thing across a DST change. */
function segmentName(timestampMs: number): string {
  return `${new Date(timestampMs).toISOString().slice(0, 10)}${SEGMENT_EXTENSION}`
}

/**
 * The first instant *after* the day a segment covers, or null when the name is
 * not one of ours. Retention compares against this rather than the day's start:
 * a segment may only go once its youngest possible event is past the cutoff.
 */
function segmentEndMs(name: string): number | null {
  const match = SEGMENT_PATTERN.exec(name)
  if (!match) {
    return null
  }
  const [, year, month, day] = match
  const start = Date.parse(`${year}-${month}-${day}T00:00:00.000Z`)
  return Number.isNaN(start) ? null : start + DAY_MS
}

function isStoredEvent(value: unknown): value is StoredEvent {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const event = value as Partial<StoredEvent>
  return (
    typeof event.id === 'string' &&
    event.id.length > 0 &&
    typeof event.recordingUrl === 'string' &&
    event.type === 'play' &&
    typeof event.completion === 'number' &&
    Number.isFinite(event.completion) &&
    typeof event.receivedAt === 'string'
  )
}

/** What the dedupe index is keyed on. See `dedupeKey`. */
type EventIdentity = Pick<PlaybackEvent, 'id' | 'deviceId'>

/**
 * Ids are minted per device, so they are unique only within one.
 *
 * Nothing forces a guest to use a UUID. Two devices with the same naive id
 * scheme would otherwise have the second one's plays dropped as duplicates.
 * Events with no device share one bucket and dedupe against each other, which
 * is the old behaviour and still correct.
 */
function dedupeKey(event: EventIdentity): string {
  return `${event.deviceId ?? 'unknown'}\u0000${event.id}`
}

export function createEventStore(root: string) {
  const logDir = path.join(root, 'log')
  const seen = new Set<string>()
  let opened = false

  // The host is a single process, so chaining appends in memory is enough to
  // keep two concurrent ingests from interleaving inside one batch's bytes.
  let tail: Promise<unknown> = Promise.resolve()

  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    // Run whether or not the previous append settled; one failed write must
    // not wedge the log for the rest of the launch.
    const run = tail.then(fn, fn)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function segments(): Promise<string[]> {
    try {
      return (await readdir(logDir))
        .filter((name) => SEGMENT_PATTERN.test(name))
        .sort()
    } catch {
      return []
    }
  }

  /**
   * Yields every event in a segment, skipping anything unreadable.
   *
   * A line that will not parse is the torn tail of an unclean quit. Skipping it
   * loses one event rather than refusing to read the 90 days in front of it.
   */
  async function* readSegment(name: string): AsyncGenerator<StoredEvent> {
    const stream = createReadStream(path.join(logDir, name), 'utf-8')
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (line.trim().length === 0) {
          continue
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        if (isStoredEvent(parsed)) {
          yield parsed
        }
      }
    } finally {
      lines.close()
      stream.destroy()
    }
  }

  /**
   * Loads the dedupe index into memory. Every other method assumes this has
   * run: an ingest against an empty index would re-admit events already in the
   * log and double their counts. The index stays in memory because the ingest
   * route is retried after lost responses, so dedupe is on the hot path.
   */
  async function open(): Promise<number> {
    if (opened) {
      return seen.size
    }
    await mkdir(logDir, { recursive: true })
    for (const name of await segments()) {
      for await (const event of readSegment(name)) {
        seen.add(dedupeKey(event))
      }
    }
    opened = true
    return seen.size
  }

  /**
   * Whether this device's event is already held. Takes the event rather than a
   * bare id because the id alone does not identify one. See `dedupeKey`.
   */
  function has(event: EventIdentity): boolean {
    return seen.has(dedupeKey(event))
  }

  /**
   * Appends the events this store has not already taken.
   *
   * Shape validation belongs to the ingest route, which must tell a guest which
   * events were rejected. The store only skips an event with no id, since it
   * could never be deduped.
   */
  async function append(
    events: PlaybackEvent[],
    now = Date.now(),
  ): Promise<AppendResult> {
    return serialize(async () => {
      const accepted: StoredEvent[] = []
      const duplicates: string[] = []
      const receivedAt = new Date(now).toISOString()

      for (const event of events) {
        if (typeof event.id !== 'string' || event.id.length === 0) {
          continue
        }
        // Also catches a batch that repeats an id inside itself, since the
        // index is updated as we go rather than after the write.
        const key = dedupeKey(event)
        if (seen.has(key)) {
          // Reported as the bare id: that is the vocabulary the client queue
          // speaks, and a client only ever sees its own device.
          duplicates.push(event.id)
          continue
        }
        seen.add(key)
        accepted.push({ ...event, receivedAt })
      }

      if (accepted.length === 0) {
        return { accepted, duplicates }
      }

      await mkdir(logDir, { recursive: true })
      const target = path.join(logDir, segmentName(now))
      const payload = `${accepted.map((event) => JSON.stringify(event)).join('\n')}\n`
      try {
        // One `appendFile` for the whole batch: two ingests cannot interleave
        // lines, and a crash mid-write can only truncate the final one.
        await appendFile(target, payload)
      } catch (error) {
        // The ids never reached disk, so they must not stay in the index. The
        // client will retry the flush and has to be able to get them in.
        for (const event of accepted) {
          seen.delete(dedupeKey(event))
        }
        throw error
      }

      return { accepted, duplicates }
    })
  }

  /**
   * Every event held, oldest segment first, for recomputing aggregates from
   * scratch. Streamed rather than returned as an array: 90 days of a busy
   * library is not something to hold in memory all at once.
   */
  async function* replay(): AsyncGenerator<StoredEvent> {
    for (const name of await segments()) {
      yield* readSegment(name)
    }
  }

  /**
   * Drops whole day segments once every event they could hold is past the
   * cutoff, and forgets their ids so the index does not grow without bound.
   *
   * Day granularity means an event can outlive retention by up to a day. That
   * is the cost of never rewriting a file the appender may hold open.
   */
  async function sweep(
    maxAgeMs = DEFAULT_EVENT_MAX_AGE_MS,
    now = Date.now(),
    options: SweepOptions = {},
  ): Promise<SweepResult> {
    const cutoff = now - maxAgeMs
    const removed: string[] = []
    const retained: string[] = []
    let events = 0

    for (const name of await segments()) {
      const end = segmentEndMs(name)
      if (end === null || end > cutoff) {
        continue
      }
      // Read before unlinking: these events are the only ones the hook can be
      // given and the only ids the index may safely forget, and after the `rm`
      // both are unknowable.
      const expiring: StoredEvent[] = []
      try {
        for await (const event of readSegment(name)) {
          expiring.push(event)
        }
      } catch {
        // Unreadable segments are swept anyway; they are past retention and
        // nothing can derive an aggregate from them.
      }

      if (options.onSegment) {
        try {
          await options.onSegment(name, expiring)
        } catch (error) {
          console.error(
            `Event log: keeping expired segment ${name}; ` +
              `folding it failed:`,
            error,
          )
          retained.push(name)
          continue
        }
      }

      await rm(path.join(logDir, name), { force: true })
      for (const event of expiring) {
        seen.delete(dedupeKey(event))
      }
      removed.push(name)
      events += expiring.length
    }

    return { segments: removed, events, retained }
  }

  /** Events currently deduped against, for logging and tests. */
  function size(): number {
    return seen.size
  }

  return {
    open,
    has,
    append,
    replay,
    // Segment-at-a-time reading, for a reader that has to *skip* one:
    // `aggregates.ts` replays the log around segments already folded into its
    // frozen baseline, which a whole-log `replay` cannot express.
    listSegments: segments,
    replaySegment: readSegment,
    sweep,
    size,
  }
}
