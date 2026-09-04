import path from 'path'
import { createReadStream } from 'fs'
import { appendFile, mkdir, readdir, rm } from 'fs/promises'
import { createInterface } from 'readline'

/**
 * A durable, append-only log of playback events, owned by the sync host.
 *
 * Aggregates are *derived* from this log rather than kept as merged counters,
 * which is the whole reason the raw events have to survive a restart: a counter
 * that two peers increment concurrently cannot be repaired, but a log can be
 * replayed. `deriveAggregates` reads this back from scratch.
 *
 * Three properties do the real work here:
 *
 * - **Append-only, never rewritten.** Every write is an `appendFile` to the end
 *   of a day segment. An unclean quit can therefore only ever leave a torn
 *   *last line*, which every reader skips, and no reader can observe a
 *   half-updated store the way it could with a rewritten JSON blob.
 * - **Dedupe from memory, not from disk.** The set of event ids is built once
 *   when the store opens and kept in memory afterwards, so answering "have I
 *   seen this id?" for every event of every ingest costs nothing. `POST
 *   /events` retries after a lost response, so this runs on the hot path.
 * - **Retention by whole segments.** Sweeping means unlinking day files, never
 *   editing one in place — same failure mode as the blob store's `tmp` sweep,
 *   and for the same reason.
 *
 * Deliberately free of any `electron` import, like `blobStore.ts`: path
 * resolution lives in `syncServerConfig`, so this can be tested in a plain node
 * process against a real directory.
 */

/** Raw events are kept for 90 days; the aggregates derived from them are not. */
export const DEFAULT_EVENT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

const SEGMENT_EXTENSION = '.ndjson'
const SEGMENT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.ndjson$/
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * One playback of one recording, as reported by a guest.
 *
 * `id` is minted client-side and is the only thing that makes a flush safely
 * retryable — a queue that resent a batch after a lost response would otherwise
 * double every count in it.
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
   * Host clock, stamped on acceptance. Retention keys on this and not on
   * `occurredAt`: a guest whose clock is years fast would otherwise hold its
   * events past every sweep, and one running years slow would have them
   * collected before they were ever counted.
   */
  receivedAt: string
}

export type AppendResult = {
  /** Events written, in the order they were given. */
  accepted: StoredEvent[]
  /** Ids already in the log; the caller may clear them from its queue. */
  duplicates: string[]
}

export type SweepResult = {
  /** Day segments unlinked whole. */
  segments: string[]
  /** Events those segments held. */
  events: number
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
   * A line that will not parse is a write the process did not finish — the
   * torn tail of an unclean quit. Skipping it loses that one event, which is
   * the correct trade against refusing to read the 90 days in front of it.
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
   * Loads the dedupe index. Every other method assumes this has run: accepting
   * an ingest against an empty index would re-admit events already in the log
   * and double their counts.
   */
  async function open(): Promise<number> {
    if (opened) {
      return seen.size
    }
    await mkdir(logDir, { recursive: true })
    for (const name of await segments()) {
      for await (const event of readSegment(name)) {
        seen.add(event.id)
      }
    }
    opened = true
    return seen.size
  }

  function has(id: string): boolean {
    return seen.has(id)
  }

  /**
   * Appends the events this store has not already taken.
   *
   * Shape validation belongs to the ingest route, which has to answer a guest
   * about *which* of its events were rejected; the store only guards what it
   * cannot store meaningfully — an event with no id could never be deduped.
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
        if (seen.has(event.id)) {
          duplicates.push(event.id)
          continue
        }
        seen.add(event.id)
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
        // The ids never reached disk, so they must not stay in the index — the
        // client will retry the flush and has to be able to get them in.
        for (const event of accepted) {
          seen.delete(event.id)
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
   * Day granularity means an event can outlive the retention window by up to a
   * day. That is the price of never rewriting a file the appender may be
   * holding open, which is what keeps an unclean quit from corrupting the log.
   */
  async function sweep(
    maxAgeMs = DEFAULT_EVENT_MAX_AGE_MS,
    now = Date.now(),
  ): Promise<SweepResult> {
    const cutoff = now - maxAgeMs
    const removed: string[] = []
    let events = 0

    for (const name of await segments()) {
      const end = segmentEndMs(name)
      if (end === null || end > cutoff) {
        continue
      }
      // Read before unlinking: the ids in this segment are the only ones the
      // index may safely forget, and after the `rm` they are unknowable.
      const ids: string[] = []
      try {
        for await (const event of readSegment(name)) {
          ids.push(event.id)
        }
      } catch {
        // Unreadable segments are swept anyway; they are past retention and
        // nothing can derive an aggregate from them.
      }
      await rm(path.join(logDir, name), { force: true })
      for (const id of ids) {
        seen.delete(id)
      }
      removed.push(name)
      events += ids.length
    }

    return { segments: removed, events }
  }

  /** Ids currently deduped against, for logging and tests. */
  function size(): number {
    return seen.size
  }

  return { open, has, append, replay, sweep, size }
}
