import { describe, expect, it, vi } from 'vitest'
import { callWorker, WorkerRequestError } from './workerClient'

/**
 * Stands in for the web-client's storage worker. Colocated rather than shipped
 * as a module so the library build never picks it up.
 */
class FakeWorker extends EventTarget {
  readonly sent: Array<{ type: string; payload: Record<string, unknown> }> = []

  constructor(
    private readonly reply: (
      message: { type: string; payload: Record<string, unknown> },
      worker: FakeWorker,
    ) => Record<string, unknown> | undefined,
  ) {
    super()
  }

  postMessage(message: { type: string; payload: Record<string, unknown> }) {
    this.sent.push(message)
    const response = this.reply(message, this)
    if (response) {
      this.emit(response)
    }
  }

  emit(data: Record<string, unknown>) {
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent('message', { data }))
    })
  }
}

const asWorker = (fake: FakeWorker) => fake as unknown as Worker

describe('callWorker', () => {
  it('resolves with the payload of the matching reply', async () => {
    const fake = new FakeWorker(({ type, payload }) => ({
      type: `${type}:response`,
      requestId: payload.requestId,
      success: true,
      payload: { bytes: 42 },
    }))

    await expect(
      callWorker<{ bytes: number }>(asWorker(fake), 'blob:get', {
        hash: 'abc',
      }),
    ).resolves.toEqual({ bytes: 42 })
    expect(fake.sent[0].payload).toMatchObject({ hash: 'abc' })
  })

  it('rejects when the worker reports failure', async () => {
    const fake = new FakeWorker(({ type, payload }) => ({
      type: `${type}:response`,
      requestId: payload.requestId,
      success: false,
      error: 'NotFoundError',
    }))

    await expect(
      callWorker(asWorker(fake), 'blob:get', { hash: 'abc' }),
    ).rejects.toThrow(WorkerRequestError)
  })

  // The whole point of the helper: the worker is one switch with no
  // correlation, so overlapping requests used to be able to take each other's
  // replies.
  it('routes overlapping requests to their own callers', async () => {
    const pending: Array<{ requestId: unknown; hash: unknown }> = []
    const fake = new FakeWorker(({ payload }) => {
      pending.push({ requestId: payload.requestId, hash: payload.hash })
      return undefined
    })

    const first = callWorker<string>(asWorker(fake), 'blob:get', { hash: 'a' })
    const second = callWorker<string>(asWorker(fake), 'blob:get', { hash: 'b' })

    // Answer out of order, as a worker reading two files would.
    fake.emit({
      type: 'blob:get:response',
      requestId: pending[1].requestId,
      success: true,
      payload: 'second',
    })
    fake.emit({
      type: 'blob:get:response',
      requestId: pending[0].requestId,
      success: true,
      payload: 'first',
    })

    await expect(second).resolves.toBe('second')
    await expect(first).resolves.toBe('first')
  })

  it('ignores replies that carry no matching request id', async () => {
    const fake = new FakeWorker(() => undefined)
    const settled = vi.fn()
    const promise = callWorker(asWorker(fake), 'blob:get', {}).then(settled)

    fake.emit({ type: 'blob:get:response', success: true, payload: 'stray' })
    await Promise.resolve()

    expect(settled).not.toHaveBeenCalled()

    const requestId = fake.sent[0].payload.requestId
    fake.emit({
      type: 'blob:get:response',
      requestId,
      success: true,
      payload: 'mine',
    })
    await promise
    expect(settled).toHaveBeenCalledWith('mine')
  })

  it('rejects and stops listening when the caller aborts', async () => {
    const fake = new FakeWorker(() => undefined)
    const controller = new AbortController()

    const promise = callWorker(
      asWorker(fake),
      'blob:get',
      {},
      {
        signal: controller.signal,
      },
    )
    controller.abort()

    await expect(promise).rejects.toThrow('Aborted')
  })
})
