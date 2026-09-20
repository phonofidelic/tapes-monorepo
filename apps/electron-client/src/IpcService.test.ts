import { describe, it, expect, vi, afterEach } from 'vitest'
import { ElectronIpcService } from './IpcService'

/**
 * The renderer half of a request.
 *
 * Requests used to carry a reply channel named after the channel and the
 * current millisecond. Two requests on one channel in the same millisecond
 * shared a name, and both promises then resolved with whichever answer landed
 * first. These cover the pairing, which is now Electron's job.
 */

function stubBridge(invoke: (channel: string, data: unknown) => unknown) {
  const spy = vi.fn(invoke)
  vi.stubGlobal('window', { api: { invoke: spy, subscribe: vi.fn() } })
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the electron ipc service', () => {
  it('resolves with the answer to its own request', async () => {
    stubBridge(() =>
      Promise.resolve({ success: true, data: { present: true } }),
    )

    await expect(
      new ElectronIpcService().send('blob:has', { data: { hash: 'abc' } }),
    ).resolves.toEqual({ success: true, data: { present: true } })
  })

  // The defect this replaced: same channel, same tick, and the slower answer
  // belongs to the first request.
  it('keeps two requests on one channel in one tick apart', async () => {
    const answers: Record<string, { delay: number; hash: string }> = {
      'hash-one': { delay: 10, hash: 'hash-one' },
      'hash-two': { delay: 0, hash: 'hash-two' },
    }
    stubBridge((_channel, data) => {
      const { hash } = (data as { data: { hash: string } }).data
      const answer = answers[hash]
      return new Promise((resolve) =>
        setTimeout(() => resolve(answer), answer.delay),
      )
    })
    const ipc = new ElectronIpcService()

    const [first, second] = await Promise.all([
      ipc.send<{ hash: string }>('blob:has', { data: { hash: 'hash-one' } }),
      ipc.send<{ hash: string }>('blob:has', { data: { hash: 'hash-two' } }),
    ])

    expect(first.hash).toBe('hash-one')
    expect(second.hash).toBe('hash-two')
  })

  // Nothing in a request names a channel to answer on any more.
  it('sends the request as the caller wrote it', async () => {
    const invoke = stubBridge(() => Promise.resolve({ success: true }))

    await new ElectronIpcService().send('blob:has', { data: { hash: 'abc' } })

    expect(invoke).toHaveBeenCalledWith('blob:has', { data: { hash: 'abc' } })
  })

  it('rejects when the main process handler throws', async () => {
    stubBridge(() => Promise.reject(new Error('Blob store is not available')))

    await expect(
      new ElectronIpcService().send('blob:has', { data: { hash: 'abc' } }),
    ).rejects.toThrow(/Blob store is not available/)
  })

  it('throws when the bridge was never exposed', () => {
    vi.stubGlobal('window', {})

    expect(() => new ElectronIpcService().send('sync:get-server-info')).toThrow(
      /Unable to require renderer process/,
    )
  })
})
