/**
 * Request/response helper for the web-client's storage worker.
 *
 * The worker's `onmessage` is one switch, so a reply can only be matched to
 * its request by an id the two sides agree on. Every request made here
 * carries one, and the worker echoes it back. Nothing else should listen to
 * worker messages for a request it made. Tests fake this one seam.
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

export function callWorker<T>(
  worker: Worker,
  type: string,
  payload: Record<string, unknown> = {},
  options: { transfer?: Transferable[]; signal?: AbortSignal } = {},
): Promise<T> {
  const requestId = nextRequestId()

  return new Promise<T>((resolve, reject) => {
    const settle = (run: () => void) => {
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

    worker.addEventListener('message', onMessage)
    options.signal?.addEventListener('abort', onAbort)

    worker.postMessage(
      { type, payload: { ...payload, requestId } },
      options.transfer ?? [],
    )
  })
}
