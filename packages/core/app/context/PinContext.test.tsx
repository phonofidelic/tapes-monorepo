import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import type { IpcService } from '@/IpcService'
import { AppContextProvider, type AppContextValue } from './AppContext'
import { BlobProvider } from './BlobContext'
import { PinProvider, usePins } from './PinContext'

const HOST = { baseUrl: 'http://192.168.1.20:9001', token: 'pair-token' }

const FIRST = 'automerge:first' as AutomergeUrl
const SECOND = 'automerge:second' as AutomergeUrl

const audio = (hash: string) => ({
  hash,
  size: 4,
  mimeType: 'audio/wav',
  ext: '.wav',
})

const CLAIM = 'c1'.repeat(32)
const SESSION = 'e5'.repeat(32)

/** A storage worker backed by a map, answering the way the OPFS worker does. */
function storageWorker() {
  const stored = new Map<string, ArrayBuffer>()
  const listeners = new Set<(event: MessageEvent) => void>()
  const worker = {
    postMessage: ({
      type,
      payload,
    }: {
      type: string
      payload: { requestId: string; hash: string; bytes?: ArrayBuffer }
    }) => {
      const answer = (success: boolean, result?: unknown) =>
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener(
              new MessageEvent('message', {
                data: {
                  type: `${type}:response`,
                  requestId: payload.requestId,
                  success,
                  payload: result,
                },
              }),
            )
          }
        })
      const bytes = stored.get(payload.hash)
      switch (type) {
        case 'blob:put':
          stored.set(payload.hash, payload.bytes as ArrayBuffer)
          return answer(true, { hash: payload.hash })
        case 'blob:get':
          return bytes
            ? answer(true, { blob: new Blob([bytes]) })
            : answer(false)
        case 'blob:delete':
          stored.delete(payload.hash)
          return answer(true, { hash: payload.hash })
        default:
          return answer(false)
      }
    },
    addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MessageEvent) => void) =>
      listeners.delete(listener),
  }
  return { worker: worker as unknown as Worker, stored }
}

function renderPins(appContext: AppContextValue) {
  return renderHook(() => usePins(), {
    wrapper: ({ children }) => (
      <AppContextProvider value={appContext}>
        <BlobProvider endpoints={[HOST]}>
          <PinProvider>{children}</PinProvider>
        </BlobProvider>
      </AppContextProvider>
    ),
  })
}

const fetchMock = vi.fn((url: string) =>
  Promise.resolve(
    new Response(`bytes of ${url.split('/blobs/')[1]}`, { status: 200 }),
  ),
)

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})

describe('PinProvider', () => {
  it('keeps the signed statements of a pinned recording on this device', async () => {
    const { worker, stored } = storageWorker()
    const { result } = renderPins({ type: 'web-client', worker })

    await act(() =>
      result.current.pin(FIRST, audio('a1'.repeat(32)), [CLAIM, SESSION]),
    )

    expect([...stored.keys()]).toEqual(expect.arrayContaining([CLAIM, SESSION]))
    expect(result.current.pinnedHashes).toContain(CLAIM)
    expect(result.current.pinnedHashes).toContain(SESSION)
    const kept = await result.current.readPinnedStatement(CLAIM)
    expect(new TextDecoder().decode(kept ?? undefined)).toBe(
      `bytes of ${CLAIM}`,
    )
  })

  it('does not read the cache for a statement no pin holds', async () => {
    const { worker } = storageWorker()
    const post = vi.spyOn(worker, 'postMessage')
    const { result } = renderPins({ type: 'web-client', worker })

    expect(await result.current.readPinnedStatement(CLAIM)).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })

  it('releases statements on unpin unless another pin still lists them', async () => {
    const { worker, stored } = storageWorker()
    const { result } = renderPins({ type: 'web-client', worker })
    const otherClaim = 'c2'.repeat(32)

    await act(() =>
      result.current.pin(FIRST, audio('a1'.repeat(32)), [CLAIM, SESSION]),
    )
    await act(() =>
      result.current.pin(SECOND, audio('a2'.repeat(32)), [otherClaim, SESSION]),
    )
    await act(() => result.current.unpin(FIRST))

    expect(stored.has(CLAIM)).toBe(false)
    expect(stored.has('a1'.repeat(32))).toBe(false)
    // The session record covers both recordings.
    expect(stored.has(SESSION)).toBe(true)
    expect(result.current.pinnedHashes).toContain(SESSION)
    expect(result.current.pinnedHashes).not.toContain(CLAIM)
  })

  it('leaves an older pin without statements unpinnable', async () => {
    const { worker, stored } = storageWorker()
    stored.set('a1'.repeat(32), new ArrayBuffer(4))
    localStorage.setItem(
      'tapes.pins',
      JSON.stringify({
        [FIRST]: { hash: 'a1'.repeat(32), size: 4, pinnedAt: 1 },
      }),
    )
    const { result } = renderPins({ type: 'web-client', worker })

    await act(() => result.current.unpin(FIRST))

    expect(stored.size).toBe(0)
  })

  // The desktop store is the host's own. Statements reach it through
  // replication to the local host, which checks them on upload.
  it('caches no statements on the desktop app', async () => {
    const send = vi.fn().mockResolvedValue({ success: true, data: {} })
    const { result } = renderPins({
      type: 'electron-client',
      ipc: { send } as unknown as IpcService,
    })

    await act(() => result.current.pin(FIRST, audio('a1'.repeat(32)), [CLAIM]))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('blob:cache-put', expect.anything())
    expect(await result.current.readPinnedStatement(CLAIM)).toBeNull()
  })
})
