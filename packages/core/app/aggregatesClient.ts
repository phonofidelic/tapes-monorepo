import type { IpcService } from './IpcService'
import type { EventHost } from './eventTarget'

/**
 * Reads playback numbers from a host, over HTTP or over IPC.
 *
 * The two transports return the same shape. Callers pass the host that
 * `resolveEventTarget` chose and do not pick a transport themselves.
 *
 * This module only reads. Play counts are never written into an Automerge
 * document, because two peers counting into a shared document would double
 * every count they synced.
 */

/** Per-recording numbers. Recordings nobody has played are absent. */
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
 * Either fresh numbers, or the host confirming the held ones are current.
 * The second answer is why revalidating is cheap: a header, not the library.
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
 * Shorter than the blob timeout on purpose. Nothing waits on these numbers, so
 * a quiet host should be given up on quickly.
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
    // A host with no aggregate store is an error, not an empty library. The
    // difference is a row showing nothing against a row showing zero.
    throw new AggregatesRequestError(
      0,
      response.error?.message ?? 'Playback aggregates are not available',
    )
  }
  // No entity tag over IPC. The numbers are already in this process, so there
  // is no transfer for a tag to save.
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
 * Keeps the rows that are well formed and drops the rest.
 *
 * Rejecting the whole response would cost the library its numbers over one bad
 * row from a host on another version.
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
 * Aborts one controller when a caller's signal fires. Replaces
 * `AbortSignal.any`, which is missing from some browsers this runs in.
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
