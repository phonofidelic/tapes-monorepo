import type { AutomergeUrl } from '@automerge/automerge-repo'
import { authHeaders, type BlobEndpoint } from './blobClient'
import type { PlaySession } from './context/AudioPlayerContext'

/**
 * The durable outbox for playback events.
 *
 * A play is measured on the device that played it and counted on the host.
 * The two are often not connected, so a finished session is queued in device
 * storage and flushed when a host is reachable. The queue is kept per device,
 * never in the Automerge doc: an unsent queue is not a fact about the library.
 */

/** Shaped to the host's `PlaybackEvent`, which is what `/events` validates. */
export type PlaybackEvent = {
  /** Client-minted, and the handle the host dedupes on with `deviceId`. */
  id: string
  recordingUrl: AutomergeUrl
  type: 'play'
  completion: number
  occurredAt: string
  deviceId: string
}

/** Mirrors the host's `Rejection`; see `eventHttp.ts` for the contract. */
type Rejection = {
  index: number
  id?: string
  reason: string
  retryable: boolean
}

export type IngestResponse = {
  accepted: string[]
  duplicates: string[]
  rejected: Rejection[]
}

const QUEUE_KEY = 'tapes.eventQueue'
const DEVICE_ID_KEY = 'tapes.deviceId'

/**
 * Per edge, not in total. A phone that never sees its host again must not grow
 * this forever, and the oldest plays are the ones whose loss matters least.
 *
 * Deliberately equal to the host's `DEFAULT_MAX_BATCH_EVENTS`, so a full queue
 * always fits in a single request and the reconnect flush never has to decide
 * what to leave behind.
 */
export const DEFAULT_MAX_QUEUED_EVENTS = 500

/**
 * A v4 uuid, from `crypto.randomUUID` where it exists.
 *
 * The fallback is needed. `randomUUID` requires a secure context, and the
 * plain-HTTP LAN mode the host can run in is not one. `getRandomValues` has no
 * such restriction, so ids stay random instead of guessable.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * This device's dedupe scope, minted once and kept.
 *
 * It is not attribution and the host never surfaces it: it exists so two
 * guests cannot swallow each other's plays by minting colliding event ids.
 * Clearing site data mints a new one, which costs at most a re-send of a queue
 * that was cleared along with it.
 */
export function getDeviceId(storage: Storage): string {
  const existing = storage.getItem(DEVICE_ID_KEY)
  if (existing) {
    return existing
  }
  const minted = randomId()
  storage.setItem(DEVICE_ID_KEY, minted)
  return minted
}

type Queues = Record<string, PlaybackEvent[]>

function readQueues(storage: Storage): Queues {
  try {
    const parsed = JSON.parse(storage.getItem(QUEUE_KEY) ?? '{}')
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Queues)
      : {}
  } catch {
    return {}
  }
}

function writeQueues(storage: Storage, queues: Queues) {
  storage.setItem(QUEUE_KEY, JSON.stringify(queues))
}

/**
 * The stable key for one host's queue.
 *
 * Queues are kept per edge so a reachable host can be flushed while another is
 * away — a device that is both a host and a guest of one is the ordinary case,
 * not an exotic one.
 */
export function edgeKey(endpoint: BlobEndpoint): string {
  return endpoint.baseUrl
}

export function readQueue(
  storage: Storage,
  endpoint: BlobEndpoint,
): PlaybackEvent[] {
  const queue = readQueues(storage)[edgeKey(endpoint)]
  return Array.isArray(queue) ? queue : []
}

export function writeQueue(
  storage: Storage,
  endpoint: BlobEndpoint,
  events: readonly PlaybackEvent[],
) {
  const queues = readQueues(storage)
  if (events.length === 0) {
    delete queues[edgeKey(endpoint)]
  } else {
    queues[edgeKey(endpoint)] = [...events]
  }
  writeQueues(storage, queues)
}

/**
 * Which host counts this play.
 *
 * The seam the ownership rule lands on. There is no ownership record yet, so
 * this is the interim rule: the remote edge when the device has one, else its
 * own local host. A device holds one library, and a device with a remote edge
 * either got that library from that host or pushes it there — so the remote
 * edge is its owner in every arrangement that exists today.
 *
 * `recordingUrl` is unused by that rule and taken anyway, because ownership is
 * per recording and that is the whole point of the seam: when the ownership
 * lookup lands (TAP-105), only this function changes.
 */
export function resolveEventTarget(
  recordingUrl: AutomergeUrl,
  endpoints: readonly BlobEndpoint[],
): BlobEndpoint | undefined {
  void recordingUrl
  return endpoints.find((endpoint) => endpoint.local !== true) ?? endpoints[0]
}

/** Turn a measured session into an event this device can send. */
export function createEvent(
  session: PlaySession,
  deviceId: string,
): PlaybackEvent {
  return {
    id: randomId(),
    recordingUrl: session.recordingUrl,
    type: 'play',
    completion: session.completion,
    occurredAt: session.occurredAt,
    deviceId,
  }
}

/** Append, dropping the oldest once the cap is reached. */
export function enqueueEvent(
  storage: Storage,
  endpoint: BlobEndpoint,
  event: PlaybackEvent,
  cap = DEFAULT_MAX_QUEUED_EVENTS,
) {
  const queue = [...readQueue(storage, endpoint), event]
  writeQueue(storage, endpoint, queue.slice(Math.max(0, queue.length - cap)))
}

/**
 * What the queue keeps after a host has answered.
 *
 * The host's three lists are the contract: drop what it accepted, drop what it
 * had already taken from this device, drop the rejections it marked
 * non-retryable, and keep the rest. Anything the answer does not mention at
 * all was never taken, so it stays — a truncated or half-read response costs a
 * re-send, which the ids make harmless.
 */
export function applyIngestResponse(
  batch: readonly PlaybackEvent[],
  response: IngestResponse,
): PlaybackEvent[] {
  const settled = new Set<string>([
    ...(response.accepted ?? []),
    ...(response.duplicates ?? []),
  ])
  for (const rejection of response.rejected ?? []) {
    if (rejection.retryable) {
      continue
    }
    // `index` is the only handle on an event the host could not read an id
    // from, and it indexes the batch we sent.
    const id = rejection.id ?? batch[rejection.index]?.id
    if (id !== undefined) {
      settled.add(id)
    }
  }
  return batch.filter((event) => !settled.has(event.id))
}

/**
 * Backoff between flushes to a host that is not answering: 5s, doubling to a
 * five-minute ceiling, with jitter so several guests coming back onto one LAN
 * do not arrive in step.
 *
 * The host allows a burst of 30 requests refilling at 1/s, and a flush sends
 * the whole queue in one request, so this stays far below what would trip it.
 * Held in memory on purpose — a reload is a fresh chance for the host to be
 * there, and starting a new session inside an old backoff would delay the
 * flush for no reason.
 */
export const INITIAL_BACKOFF_MS = 5_000
export const MAX_BACKOFF_MS = 5 * 60 * 1000

export function backoffDelay(
  consecutiveFailures: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    MAX_BACKOFF_MS,
    INITIAL_BACKOFF_MS * 2 ** Math.max(0, consecutiveFailures - 1),
  )
  return Math.round(base * (0.5 + random() * 0.5))
}

export type FlushOutcome =
  /** The host answered; the queue has been cleared against its answer. */
  | { status: 'flushed'; remaining: number }
  /** Nothing was queued for this host. */
  | { status: 'empty' }
  /** The host could not be reached or could not answer. Back off and retry. */
  | { status: 'deferred' }

/**
 * Send one host everything queued for it, in a single request.
 *
 * One batch per flush rather than one request per event: the host rate-limits
 * per connection, and a reconnecting phone carrying a week of plays would
 * spend that whole budget in seconds if it sent them one at a time.
 */
export async function flushQueue(
  storage: Storage,
  endpoint: BlobEndpoint,
): Promise<FlushOutcome> {
  const batch = readQueue(storage, endpoint)
  if (batch.length === 0) {
    return { status: 'empty' }
  }

  let response: Response
  try {
    response = await fetch(`${endpoint.baseUrl}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(endpoint),
      },
      body: JSON.stringify({ events: batch }),
    })
  } catch {
    return { status: 'deferred' }
  }

  // 400, 413 and 415 mean this host will never read these bytes. Every event
  // is judged individually, so a whole-batch refusal is a fault in how the
  // batch is encoded. Keeping it would wedge the queue permanently, so drop it
  // and make the fault loud.
  if (
    response.status === 400 ||
    response.status === 413 ||
    response.status === 415
  ) {
    console.error(
      `Host refused an event batch (${response.status}); dropping ${batch.length} queued events.`,
    )
    writeQueue(storage, endpoint, [])
    return { status: 'flushed', remaining: 0 }
  }

  // Anything else that is not a 200 is a host to try again later. 401 means no
  // longer paired, and re-pairing is something the user can do. 429 and 5xx
  // ask for later outright. 404 and 405 mean this host has no events route
  // yet, which is not a reason to lose the plays.
  if (!response.ok) {
    return { status: 'deferred' }
  }

  let answer: IngestResponse
  try {
    answer = (await response.json()) as IngestResponse
  } catch {
    // A 200 we could not read. The events may well have been stored, but
    // re-sending them is safe: the host dedupes on the ids.
    return { status: 'deferred' }
  }

  // Re-read the stored queue rather than writing back `kept`: a play that
  // finished while the request was in flight was appended to it, and writing
  // back a batch that predates it would throw that play away.
  const kept = applyIngestResponse(batch, answer)
  const sentIds = new Set(batch.map((event) => event.id))
  const keptIds = new Set(kept.map((event) => event.id))
  const current = readQueue(storage, endpoint)
  writeQueue(
    storage,
    endpoint,
    current.filter((event) => !sentIds.has(event.id) || keptIds.has(event.id)),
  )
  return { status: 'flushed', remaining: kept.length }
}
