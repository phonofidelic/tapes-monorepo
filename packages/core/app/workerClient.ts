/**
 * Request/response helper for the web-client's storage worker.
 *
 * The worker's `onmessage` is one switch, so a reply can only be matched to
 * its request by an id the two sides agree on. Every request made here
 * carries one, and the worker echoes it back. Nothing else should listen to
 * worker messages for a request it made. Tests fake this one seam.
 *
 * Every request settles. A reply that never comes rejects on a timeout rather
 * than leaving the caller waiting and its listener attached.
 */

export type WorkerResponse<T> = {
  type: string
  requestId?: string
  success: boolean
  payload?: T
  error?: string
}

export class WorkerRequestError extends Error {
  constructor(
    readonly requestType: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkerRequestError'
  }
}

let counter = 0

function nextRequestId(): string {
  // Not `Date.now()`: two sends in the same millisecond would collide, which
  // is exactly the bug this helper exists to avoid.
  counter += 1
  return `${counter}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * How long a request waits before giving up, when the caller names no limit.
 *
 * Generous on purpose. The worker answers every request it receives, so this
 * should never fire; it is here for the case where it does, such as a worker
 * that died mid-request. A read of a long recording out of OPFS is the slowest
 * thing this carries, and that is far short of thirty seconds.
 */
const DEFAULT_TIMEOUT_MS = 30_000

export class WorkerTimeoutError extends Error {
  constructor(
    readonly requestType: string,
    readonly timeoutMs: number,
  ) {
    super(`Worker did not answer ${requestType} within ${timeoutMs}ms`)
    this.name = 'WorkerTimeoutError'
  }
}

export function callWorker<T>(
  worker: Worker,
  type: string,
  payload: Record<string, unknown> = {},
  options: {
    transfer?: Transferable[]
    signal?: AbortSignal
    /** Pass 0 to wait forever. */
    timeoutMs?: number
  } = {},
): Promise<T> {
  const requestId = nextRequestId()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<T>((resolve, reject) => {
    // Armed below, once this request is actually in flight.
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (run: () => void) => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      options.signal?.removeEventListener('abort', onAbort)
      run()
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as WorkerResponse<T> | undefined
      if (!data || data.requestId !== requestId) {
        return
      }
      if (!data.success) {
        settle(() =>
          reject(new WorkerRequestError(type, data.error ?? 'Worker error')),
        )
        return
      }
      settle(() => resolve(data.payload as T))
    }

    const onAbort = () => {
      settle(() => reject(new DOMException('Aborted', 'AbortError')))
    }

    if (options.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    // Rejecting rather than waiting on: a caller that never hears back holds a
    // promise that never settles and a listener that never detaches. One of
    // each per request is a leak the page cannot recover from.
    if (timeoutMs) {
      timer = setTimeout(
        () => settle(() => reject(new WorkerTimeoutError(type, timeoutMs))),
        timeoutMs,
      )
    }

    worker.addEventListener('message', onMessage)
    options.signal?.addEventListener('abort', onAbort)

    worker.postMessage(
      { type, payload: { ...payload, requestId } },
      options.transfer ?? [],
    )
  })
}
