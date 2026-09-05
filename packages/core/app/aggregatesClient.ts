import type { IpcService } from './IpcService'
import type { EventHost } from './eventTarget'

/**
 * Client for the host's playback numbers.
 *
 * Two transports, one shape. A guest — and a desktop app paired with someone
 * else's host — reads `GET /events/aggregates`; a device reading its own
 * embedded host goes over IPC instead of through its own network stack. Which
 * of the two applies is `resolveEventTarget`'s decision, not this file's.
 *
 * Every number here is derived from an event log the host owns. Nothing is
 * written back, and nothing is merged into the Automerge doc: two peers that
 * both counted plays into a shared document would double every count they
 * synced.
 */

/** Per-recording numbers. Recordings nobody has played are simply absent. */
export type RecordingAggregate = {
  recordingUrl: string
  plays: number
  /** Mean of the per-play completion values, 0..1. */
  averageCompletion: number
}

export type AggregatesSnapshot = {
  aggregates: RecordingAggregate[]
  /** When the host built this answer. */
  generatedAt: string
  /** The host's entity tag, to revalidate against rather than re-download. */
  etag?: string
}

/**
 * Either the host's numbers, or its word that the ones already held are still
 * current. The second is the point of revalidating: a reconnect after a day
 * away costs a request and a header, not the whole library.
 */
export type FetchAggregatesResult =
  { status: 'fresh'; snapshot: AggregatesSnapshot } | { status: 'unchanged' }

export class AggregatesRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AggregatesRequestError'
  }
}

/**
 * How long the host has to start answering.
 *
 * Shorter than the blob timeout, and deliberately: nothing waits on these
 * numbers. A row renders without its play count and gains one later, so a host
 * that has gone quiet should be given up on quickly rather than held open.
 */
export const AGGREGATES_RESPONSE_TIMEOUT_MS = 5_000

export const AGGREGATES_PATH = '/events/aggregates'

type IpcAggregatesResponse =
  | { success: true; data: { aggregates: unknown; generatedAt?: unknown } }
  | { success: false; error?: { message?: string } }

export type FetchAggregatesOptions = {
  /** Required for an `ipc` target; unused for `http`. */
  ipc?: IpcService
  /** The tag of the snapshot already held, if any. */
  etag?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export async function fetchAggregates(
  target: EventHost,
  options: FetchAggregatesOptions = {},
): Promise<FetchAggregatesResult> {
  if (target.kind === 'ipc') {
    return fetchOverIpc(options.ipc)
  }
  return fetchOverHttp(target, options)
}

async function fetchOverIpc(
  ipc: IpcService | undefined,
): Promise<FetchAggregatesResult> {
  if (!ipc) {
    throw new AggregatesRequestError(
      0,
      'An ipc target needs the electron app context',
    )
  }
  const response = await ipc.send<IpcAggregatesResponse>(
    'events:get-aggregates',
  )
  if (!response.success) {
    // The host answering "unavailable" is an error and not an empty library:
    // the difference is a row that shows nothing versus a row that claims a
    // confident zero.
    throw new AggregatesRequestError(
      0,
      response.error?.message ?? 'Playback aggregates are not available',
    )
  }
  return {
    status: 'fresh',
    snapshot: {
      aggregates: parseAggregates(response.data.aggregates),
      generatedAt:
        typeof response.data.generatedAt === 'string'
          ? response.data.generatedAt
          : new Date().toISOString(),
    },
  }
  // No entity tag over IPC. There is no transfer to avoid — the rollup is
  // already in this process tree — so revalidating would only add a comparison.
}

async function fetchOverHttp(
  target: Extract<EventHost, { kind: 'http' }>,
  options: FetchAggregatesOptions,
): Promise<FetchAggregatesResult> {
  const controller = new AbortController()
  const unlink = linkAbort(controller, options.signal)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? AGGREGATES_RESPONSE_TIMEOUT_MS)

  try {
    const response = await fetch(`${target.baseUrl}${AGGREGATES_PATH}`, {
      headers: {
        ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}),
        ...(options.etag ? { 'If-None-Match': options.etag } : {}),
      },
      signal: controller.signal,
    })

    if (response.status === 304) {
      return { status: 'unchanged' }
    }
    if (!response.ok) {
      throw new AggregatesRequestError(
        response.status,
        await errorMessage(response),
      )
    }

    const body = (await response.json()) as {
      aggregates?: unknown
      generatedAt?: unknown
    }
    return {
      status: 'fresh',
      snapshot: {
        aggregates: parseAggregates(body.aggregates),
        generatedAt:
          typeof body.generatedAt === 'string'
            ? body.generatedAt
            : new Date().toISOString(),
        etag: response.headers.get('etag') ?? undefined,
      },
    }
  } catch (error) {
    if (timedOut) {
      throw new AggregatesRequestError(0, 'The host did not answer in time')
    }
    throw error
  } finally {
    clearTimeout(timer)
    unlink()
  }
}

/**
 * Takes the rows that are well formed and drops the rest.
 *
 * A stricter reading would be worse here: one malformed row from a newer or
 * older host would cost the whole library its numbers, and these are
 * decorations on a list that renders fine without them.
 */
function parseAggregates(value: unknown): RecordingAggregate[] {
  if (!Array.isArray(value)) {
    return []
  }
  const parsed: RecordingAggregate[] = []
  for (const row of value) {
    if (typeof row !== 'object' || row === null) {
      continue
    }
    const { recordingUrl, plays, averageCompletion } = row as Record<
      string,
      unknown
    >
    if (
      typeof recordingUrl !== 'string' ||
      recordingUrl.length === 0 ||
      typeof plays !== 'number' ||
      !Number.isFinite(plays) ||
      typeof averageCompletion !== 'number' ||
      !Number.isFinite(averageCompletion)
    ) {
      continue
    }
    parsed.push({
      recordingUrl,
      plays,
      averageCompletion: Math.min(1, Math.max(0, averageCompletion)),
    })
  }
  return parsed
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (body.error) {
      return body.error
    }
  } catch {
    // Non-JSON body; the status text will do.
  }
  return response.statusText
}

/**
 * `AbortSignal.any` would express this, but it is still missing from enough of
 * the browsers and test environments this runs in to be worth the few lines.
 */
function linkAbort(
  controller: AbortController,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) {
    return () => {}
  }
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => {}
  }
  const onAbort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', onAbort)
  return () => signal.removeEventListener('abort', onAbort)
}
