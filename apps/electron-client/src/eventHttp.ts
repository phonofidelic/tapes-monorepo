import { createHash } from 'crypto'
import type http from 'http'
import type { RecordingAggregate } from './aggregates'
import type { EventStore, PlaybackEvent, StoredEvent } from './eventStore'
import { isAuthorized } from './tokenAuth'
import { CORS_HEADERS, sendJson, sendStatus } from './httpResponses'

/**
 * The `/events` ingest surface: where a guest's queued plays land.
 *
 * Mounted on the same origin, port and pairing token as `/blobs`, and for the
 * same reasons — a guest already reaches this host and already holds the
 * token, so there is no new port to open, no second CORS story, and nothing
 * further to configure. Like the blob routes it must be mounted *ahead* of the
 * static handler, whose SPA fallback answers any unmatched path with a 200 and
 * a page of HTML.
 *
 * **Two directions on one path.** `POST /events` takes what a guest played;
 * `GET /events/aggregates` hands back what every recording adds up to. They
 * share this file because they share the log, the token and the origin.
 *
 * **A flush is a batch.** The client queues events while offline and sends
 * what it has in one request, so the interesting case is not one event but a
 * mixed batch, and the answer has to be per event: see `IngestResponse`.
 *
 * **These numbers are not tamper-proof.** An event carries no authentication
 * beyond the pairing token, which every guest holds, so anyone the host handed
 * a QR code to can inflate a count. That is an accepted trade for a LAN tool
 * among people you invited; it is written down here so nobody later reads
 * "plays" as an audited figure. What the rate limit below defends is the disk,
 * not the integrity of the counts.
 */

export const EVENTS_PATH = '/events'

/**
 * The read path: every recording's numbers in one response.
 *
 * A sub-path of `/events` rather than a route of its own, because it is the
 * same log seen from the other side and shares the token, the origin and the
 * CORS story with the ingest above it.
 *
 * Whole-library and never per-recording. The Library renders every row at
 * once, so a per-recording route would turn one screen into a request per
 * tape — a hundred round trips over a LAN, to move a few hundred bytes.
 */
export const AGGREGATES_PATH = '/events/aggregates'

/** Events per request. A flush of more than this is a bug or an attack. */
export const DEFAULT_MAX_BATCH_EVENTS = 500

/**
 * Body ceiling, checked as bytes arrive rather than trusting `Content-Length`
 * (which a client may omit or lie about). Comfortably above a full batch of
 * plausible events.
 */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

/**
 * Per-connection token bucket: a burst the size of a genuine reconnect flush,
 * refilling slowly enough that a loop cannot outrun it.
 */
export const DEFAULT_RATE_BURST = 30
export const DEFAULT_RATE_REFILL_PER_SECOND = 1

/** Why an event was not stored. */
export type RejectionReason =
  /** Shape is wrong; resending the same bytes will fail identically. */
  | 'malformed'
  /** `recordingUrl` names no recording this host holds. */
  | 'unknown-recording'

export type Rejection = {
  /** Position in the submitted batch, the only handle on an event with no id. */
  index: number
  id?: string
  reason: RejectionReason
  /**
   * Whether the client should keep the event queued.
   *
   * Only `unknown-recording` is retryable, and it genuinely is: a guest that
   * played offline may reach `/events` before the recording's document has
   * finished syncing to this host, and dropping the play then would lose
   * exactly the event this whole feature exists to catch.
   */
  retryable: boolean
}

/**
 * The honest answer to a partial batch, and the contract the client queue
 * clears itself against: drop `accepted` and `duplicates`, drop the rejections
 * marked non-retryable, keep everything else.
 *
 * Anything absent from all three lists was never taken — a client that loses
 * the response entirely re-sends the batch and is deduped on arrival.
 */
export type IngestResponse = {
  accepted: string[]
  /** Ids this device had already sent. Counted once; safe for it to forget. */
  duplicates: string[]
  rejected: Rejection[]
}

/**
 * What this route needs from the aggregate store, and no more: read the
 * rollup, and fold in what an ingest just accepted. Narrow on purpose — a
 * route must never be the thing that triggers a rebuild or a sweep.
 */
export type Aggregates = {
  all(): RecordingAggregate[]
  /**
   * Called with what the log *accepted*, so a read straight after a flush is
   * not stale. Duplicates are dropped before they get here, which is what
   * keeps a retried flush from counting twice.
   */
  record(accepted: StoredEvent[]): void
}

/**
 * The read path's answer.
 *
 * `generatedAt` is when this response was built, not when the numbers last
 * changed: it dates the snapshot a client is holding, which is what a cache
 * with a TTL needs. Recordings with no plays are absent rather than sent as
 * zeros — the Library knows its own rows, and an empty list is the honest
 * shape for a library nobody has played yet.
 */
export type AggregatesResponse = {
  aggregates: RecordingAggregate[]
  generatedAt: string
}

export type EventHandlerOptions = {
  store: EventStore
  /**
   * Aggregates over that log. Absent when they failed to open, in which case
   * reads answer 503 and ingest carries on: the log is still the durable
   * thing, and a rollup can be rebuilt from it later.
   */
  aggregates?: Aggregates
  /**
   * Shared secret from `sync-server.json`, as for `/blobs`. Absent only in
   * tests that exercise the unguarded shape.
   */
  token?: string
  /**
   * Whether this host knows the recording an event names. Omitted in tests
   * that are not exercising that check; when absent, every well-formed
   * recording url is taken.
   */
  isKnownRecording?: (recordingUrl: string) => Promise<boolean>
  maxBatchEvents?: number
  maxBodyBytes?: number
  rateBurst?: number
  rateRefillPerSecond?: number
  now?: () => number
}

class BodyTooLargeError extends Error {}

/**
 * Reads the request body, abandoning it the moment it passes `maxBytes` rather
 * than buffering whatever a client chooses to send.
 */
async function readBody(
  request: http.IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) {
      throw new BodyTooLargeError('Event batch is too large')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * Clamped to `[0, 1]` rather than rejected.
 *
 * Completion is a measurement, and the client computing it divides by a
 * duration that browsers report as `Infinity` mid-stream and revise once
 * metadata lands; a 1.02 is a rounding artefact of a play that genuinely
 * finished, not a lie worth discarding a play over. Values that are not
 * numbers at all still fail validation below.
 */
function clampCompletion(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Automerge url shape only — whether the host *holds* that recording is a
 * separate, asynchronous question (`isKnownRecording`).
 *
 * Deliberately a regex and not an `isValidAutomergeUrl` import: this file, like
 * `blobStore.ts`, stays free of Automerge and Electron so the HTTP surface can
 * be tested against a real server in a plain node process.
 */
const RECORDING_URL_PATTERN = /^automerge:[1-9A-HJ-NP-Za-km-z]{16,}$/

type Validated =
  | { ok: true; event: PlaybackEvent }
  | { ok: false; id?: string; reason: RejectionReason }

function validate(value: unknown): Validated {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'malformed' }
  }
  const raw = value as Record<string, unknown>
  const id =
    typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : undefined
  if (!id) {
    return { ok: false, reason: 'malformed' }
  }
  if (raw.type !== 'play') {
    return { ok: false, id, reason: 'malformed' }
  }
  if (
    typeof raw.recordingUrl !== 'string' ||
    !RECORDING_URL_PATTERN.test(raw.recordingUrl)
  ) {
    return { ok: false, id, reason: 'malformed' }
  }
  if (typeof raw.completion !== 'number' || !Number.isFinite(raw.completion)) {
    return { ok: false, id, reason: 'malformed' }
  }
  if (
    typeof raw.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(raw.occurredAt))
  ) {
    return { ok: false, id, reason: 'malformed' }
  }
  const deviceId =
    typeof raw.deviceId === 'string' && raw.deviceId.length > 0
      ? raw.deviceId
      : undefined

  return {
    ok: true,
    event: {
      id,
      recordingUrl: raw.recordingUrl,
      type: 'play',
      completion: clampCompletion(raw.completion),
      occurredAt: raw.occurredAt,
      deviceId,
    },
  }
}

/**
 * A token bucket per connection.
 *
 * Keyed on the socket and held in a `WeakMap`, so a bucket is collected with
 * the connection that owns it rather than accumulating one entry per guest
 * that ever paired. Per connection is the granularity the threat needs: the
 * concern is a loop filling the disk, and a loop runs over a kept-alive
 * socket. It is not an identity check — a determined client can reconnect —
 * which is the same trade the note at the top of this file describes.
 */
function createRateLimiter(
  burst: number,
  refillPerSecond: number,
  now: () => number,
) {
  const buckets = new WeakMap<object, { tokens: number; updated: number }>()

  return function take(key: object): boolean {
    const at = now()
    const bucket = buckets.get(key) ?? { tokens: burst, updated: at }
    bucket.tokens = Math.min(
      burst,
      bucket.tokens + ((at - bucket.updated) / 1000) * refillPerSecond,
    )
    bucket.updated = at
    buckets.set(key, bucket)
    if (bucket.tokens < 1) {
      return false
    }
    bucket.tokens -= 1
    return true
  }
}

export function createEventRequestHandler(options: EventHandlerOptions) {
  const {
    store,
    aggregates,
    token,
    isKnownRecording,
    maxBatchEvents = DEFAULT_MAX_BATCH_EVENTS,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    rateBurst = DEFAULT_RATE_BURST,
    rateRefillPerSecond = DEFAULT_RATE_REFILL_PER_SECOND,
    now = Date.now,
  } = options

  const take = createRateLimiter(rateBurst, rateRefillPerSecond, now)

  async function handleIngest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    const contentType = (request.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (contentType !== 'application/json') {
      request.resume()
      sendJson(response, 415, { error: 'Expected an application/json body' })
      return
    }

    let body: string
    try {
      body = await readBody(request, maxBodyBytes)
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { error: error.message })
        // The client may still be sending; without this it keeps pushing bytes
        // at a socket that has already been answered.
        request.destroy()
        return
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      sendJson(response, 400, { error: 'Body is not valid JSON' })
      return
    }

    // Accepts `{ events: [...] }` or a bare array: the envelope leaves room for
    // batch-level fields later without a second route.
    const submitted = Array.isArray(parsed)
      ? parsed
      : (parsed as { events?: unknown } | null)?.events
    if (!Array.isArray(submitted)) {
      sendJson(response, 400, { error: 'Expected an array of events' })
      return
    }
    if (submitted.length > maxBatchEvents) {
      // Refused whole rather than truncated: a client told "accepted" about a
      // prefix would clear the rest of its queue unsent.
      sendJson(response, 413, {
        error: `Batch exceeds ${maxBatchEvents} events`,
      })
      return
    }

    const rejected: Rejection[] = []
    const valid: PlaybackEvent[] = []

    for (const [index, candidate] of submitted.entries()) {
      const result = validate(candidate)
      if (!result.ok) {
        rejected.push({
          index,
          id: result.id,
          reason: result.reason,
          retryable: false,
        })
        continue
      }
      const known =
        !isKnownRecording || (await isKnownRecording(result.event.recordingUrl))
      if (!known) {
        rejected.push({
          index,
          id: result.event.id,
          reason: 'unknown-recording',
          retryable: true,
        })
        continue
      }
      valid.push(result.event)
    }

    const { accepted, duplicates } = await store.append(valid)

    // Folded in here rather than derived on the next read: the rollup exists so
    // that a read is a map lookup, and a client that flushes a play and then
    // renders the Library would otherwise see the old number until this host
    // next restarted and replayed the log.
    aggregates?.record(accepted)

    const answer: IngestResponse = {
      accepted: accepted.map((event) => event.id),
      duplicates,
      rejected,
    }
    // 200 even when nothing was accepted: the batch was understood and
    // answered per event, which is what the client needs in order to know what
    // to clear. A status code it had to interpret would say less than the
    // three lists already do.
    sendJson(response, 200, answer)
  }

  /**
   * Serves the whole rollup, with an entity tag so a reconnecting client can
   * ask whether anything changed instead of re-reading numbers it already has.
   *
   * The list is sorted by recording url, which is what makes that tag mean
   * anything: the rollup is a `Map`, and its iteration order follows whether
   * the process rebuilt from the log or folded events in as they arrived. Two
   * hosts holding identical numbers would otherwise hand out different tags,
   * and one host would invalidate every client each time it restarted.
   */
  function handleAggregates(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    if (!aggregates) {
      sendJson(response, 503, {
        error: 'Playback aggregates are not available',
      })
      return
    }

    const sorted = [...aggregates.all()].sort((a, b) =>
      a.recordingUrl < b.recordingUrl
        ? -1
        : a.recordingUrl > b.recordingUrl
          ? 1
          : 0,
    )
    const etag = `"${createHash('sha256')
      .update(JSON.stringify(sorted))
      .digest('hex')
      .slice(0, 32)}"`

    // The client sends back exactly the tag it was given, so an equality test
    // is the whole of the comparison.
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ...CORS_HEADERS, ETag: etag })
      response.end()
      return
    }

    const body: AggregatesResponse = {
      aggregates: sorted,
      generatedAt: new Date(now()).toISOString(),
    }
    const payload = JSON.stringify(body)
    response.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      ETag: etag,
      // The client holds its own TTL; this keeps anything between them from
      // holding a copy for longer than the host would.
      'Cache-Control': 'no-cache',
    })
    // HEAD gets the headers and no body, so a client can check the tag without
    // paying for the list.
    response.end(request.method === 'HEAD' ? undefined : payload)
  }

  /**
   * Returns true when the request was an events request and has been answered,
   * so the caller knows not to fall through to the static handler.
   */
  return async function handleEventRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const isAggregates = url.pathname === AGGREGATES_PATH
    if (!isAggregates && url.pathname !== EVENTS_PATH) {
      return false
    }

    const method = request.method ?? 'GET'
    if (method === 'OPTIONS') {
      sendStatus(response, 204)
      return true
    }

    if (!isAuthorized(request, url, token)) {
      request.resume()
      sendJson(response, 401, { error: 'Unauthorized' })
      return true
    }

    const allowed = isAggregates
      ? method === 'GET' || method === 'HEAD'
      : method === 'POST'
    if (!allowed) {
      sendJson(response, 405, { error: 'Method not allowed' })
      return true
    }

    // After the token check, so an unauthorized caller cannot spend a paired
    // guest's budget, and before the body is read, so a refused request costs
    // neither parsing nor disk. Reads share the bucket: serializing the whole
    // library is cheap but not free, and a client looping on a read is the
    // same bug as a client looping on a flush.
    if (!take(request.socket)) {
      request.resume()
      // Written by hand rather than through `sendJson` for the `Retry-After`:
      // the client's flush already backs off, and this tells it how long to.
      const payload = JSON.stringify({ error: 'Too many event batches' })
      response.writeHead(429, {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Retry-After': String(Math.ceil(1 / rateRefillPerSecond)),
      })
      response.end(payload)
      return true
    }

    try {
      if (isAggregates) {
        request.resume()
        handleAggregates(request, response)
      } else {
        await handleIngest(request, response)
      }
      return true
    } catch (error) {
      console.error(
        isAggregates ? 'Aggregate read failed:' : 'Event ingest failed:',
        error,
      )
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: isAggregates ? 'Aggregate read failed' : 'Event ingest failed',
        })
      } else {
        response.destroy()
      }
      return true
    }
  }
}
