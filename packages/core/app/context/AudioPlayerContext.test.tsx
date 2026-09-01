import { useEffect, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { AppContextProvider, type AppContextValue } from './AppContext'
import { BlobProvider } from './BlobContext'
import { AudioPlayerProvider, useAudioPlayer } from './AudioPlayerContext'
import type { BlobEndpoint } from '@/blobClient'
import type { IpcService } from '@/IpcService'
import type { RecordingData } from '@/types'
import { blobForObjectUrl } from '../../vitest.setup'

const RECORDING_URL = 'automerge:recording' as AutomergeUrl
const HASH = 'a'.repeat(64)
const ENDPOINT: BlobEndpoint = {
  baseUrl: 'http://127.0.0.1:9001',
  token: 'pair-token',
}

let recording: RecordingData
/** Per-url documents, for tests that load more than one recording. */
let recordings: Record<string, RecordingData> = {}

vi.mock('@automerge/automerge-repo-react-hooks', () => ({
  useDocument: (url?: AutomergeUrl) => [
    url ? (recordings[url] ?? recording) : undefined,
    vi.fn(),
  ],
}))

const base: RecordingData = {
  url: RECORDING_URL,
  filename: 'take-one',
  filepath: 'take-one.wav',
  name: 'Take one',
  duration: 4,
  id: 'take-one',
}

/**
 * Loads a recording into the player and reports what the audio element was
 * pointed at, which is the only externally visible result of the resolution
 * order.
 */
function Probe({ source = base.filepath }: { source?: string }) {
  const { audioRef, setCurrentSource, setCurrentUrl, playbackState } =
    useAudioPlayer()
  const [src, setSrc] = useState('')

  useEffect(() => {
    setCurrentSource(source)
    setCurrentUrl(RECORDING_URL)
  }, [source, setCurrentSource, setCurrentUrl])

  // The player assigns `src` imperatively on an element it never mounts, so
  // mirror it into state rather than reading the ref while rendering.
  useEffect(() => {
    const timer = setInterval(() => setSrc(audioRef.current?.src ?? ''), 5)
    return () => clearInterval(timer)
  }, [audioRef])

  return (
    <>
      <output data-testid="src">{src}</output>
      <output data-testid="state">{playbackState}</output>
    </>
  )
}

/** A server this device syncs with but does not host. */
const REMOTE_ENDPOINT: BlobEndpoint = {
  baseUrl: 'https://sync.example.com',
  token: 'pair-token',
}

const renderPlayer = (
  appContext: AppContextValue,
  endpoints: readonly BlobEndpoint[] = [],
  source?: string,
) =>
  render(
    <AppContextProvider value={appContext}>
      <BlobProvider endpoints={endpoints}>
        <AudioPlayerProvider>
          <Probe source={source} />
        </AudioPlayerProvider>
      </BlobProvider>
    </AppContextProvider>,
  )

/** A storage worker whose OPFS lookups all miss. */
const emptyWorker = (): Worker =>
  workerAnswering(() => ({ success: false, error: 'NotFoundError' }))

function workerAnswering(
  reply: (message: {
    type: string
    payload: Record<string, unknown>
  }) => Record<string, unknown>,
): Worker {
  const postMessage = vi.fn()
  const listeners = new Set<(event: MessageEvent) => void>()
  return {
    postMessage: (message: {
      type: string
      payload: Record<string, unknown>
    }) => {
      postMessage(message)
      queueMicrotask(() => {
        const data = {
          type: `${message.type}:response`,
          requestId: message.payload?.requestId,
          ...reply(message),
        }
        listeners.forEach((listener) =>
          listener(new MessageEvent('message', { data })),
        )
      })
    },
    addEventListener: (
      _type: string,
      listener: (event: MessageEvent) => void,
    ) => listeners.add(listener),
    removeEventListener: (
      _type: string,
      listener: (event: MessageEvent) => void,
    ) => listeners.delete(listener),
  } as unknown as Worker
}

const electronContext = (send: ReturnType<typeof vi.fn>): AppContextValue => ({
  type: 'electron-client',
  ipc: { send } as unknown as IpcService,
})

const srcText = () => screen.getByTestId('src').textContent ?? ''

beforeEach(() => {
  cleanup()
  localStorage.clear()
  recording = base
  recordings = {}
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('legacy recordings with embedded audio', () => {
  // Automerge history is append-only, so documents written before audio moved
  // out of band keep their bytes forever. They must go on playing.
  it('plays the embedded bytes without contacting the host', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    recording = {
      ...base,
      audio: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'audio/wav',
    }

    renderPlayer({ type: 'web-client', worker: emptyWorker() }, [ENDPOINT])

    await waitFor(() => expect(srcText()).toMatch(/^blob:/))
    expect(blobForObjectUrl(srcText())?.type).toBe('audio/wav')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('recordings stored out of band', () => {
  it('plays from the local cache without contacting the host', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    recording = {
      ...base,
      blob: { hash: HASH, size: 4, mimeType: 'audio/wav', ext: '.wav' },
    }

    const worker = workerAnswering((message) =>
      message.type === 'blob:get'
        ? { success: true, payload: { blob: new Blob(['cached']) } }
        : { success: true, payload: { present: true } },
    )
    renderPlayer({ type: 'web-client', worker }, [ENDPOINT])

    await waitFor(() => expect(srcText()).toMatch(/^blob:/))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches from the host once when nothing local has it, and caches it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('audio', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    recording = {
      ...base,
      filepath: '',
      blob: { hash: HASH, size: 5, mimeType: 'audio/wav', ext: '.wav' },
    }

    const sent: string[] = []
    const worker = workerAnswering((message) => {
      sent.push(message.type)
      if (message.type === 'blob:put') {
        return { success: true, payload: {} }
      }
      return { success: false, error: 'NotFoundError' }
    })
    renderPlayer({ type: 'web-client', worker }, [ENDPOINT])

    await waitFor(() => expect(srcText()).toMatch(/^blob:/))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://127.0.0.1:9001/blobs/${HASH}`,
    )
    // Kept locally, so a guest's storage grows with what it played.
    await waitFor(() => expect(sent).toContain('blob:put'))
  })

  // A recording made on the electron host carries that machine's absolute
  // path. OPFS names are flat, so handing one to `getFileHandle` throws
  // "Name is not allowed" instead of missing — and the guest never got as far
  // as asking the host for the bytes it does have.
  it('does not look in OPFS for a recording made on the electron host', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('audio', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const filepath = '/Users/someone/Library/Tapes/take-one.wav'
    recording = {
      ...base,
      filepath,
      blob: { hash: HASH, size: 5, mimeType: 'audio/wav', ext: '.wav' },
    }

    const sent: string[] = []
    const worker = workerAnswering((message) => {
      sent.push(message.type)
      if (message.type === 'blob:put') {
        return { success: true, payload: {} }
      }
      return { success: false, error: 'NotFoundError' }
    })
    renderPlayer({ type: 'web-client', worker }, [ENDPOINT], filepath)

    await waitFor(() => expect(srcText()).toMatch(/^blob:/))
    expect(sent).not.toContain('storage:get')
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://127.0.0.1:9001/blobs/${HASH}`,
    )
  })

  // The TAP-74 case: a desktop app in remote sync mode holds a doc whose bytes
  // its own embedded store has never seen, and used to 404 against itself with
  // nowhere else to ask.
  it('asks the next host when the nearest one has never seen the blob', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith(REMOTE_ENDPOINT.baseUrl)) {
        return Promise.resolve(
          init?.method === 'POST'
            ? new Response(
                JSON.stringify({
                  hash: HASH,
                  size: 5,
                  mimeType: 'audio/wav',
                  ext: '.wav',
                }),
                { status: 201 },
              )
            : new Response('audio', { status: 200 }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Unknown blob' }), {
          status: 404,
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    recording = {
      ...base,
      filepath: '',
      blob: { hash: HASH, size: 5, mimeType: 'audio/wav', ext: '.wav' },
    }

    renderPlayer({ type: 'web-client', worker: emptyWorker() }, [
      { ...ENDPOINT, local: true },
      REMOTE_ENDPOINT,
    ])

    await waitFor(() => expect(srcText()).toMatch(/^blob:/))
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://127.0.0.1:9001/blobs/${HASH}`,
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      `https://sync.example.com/blobs/${HASH}`,
    )
    // And the host that was missing it gets a copy, so the next device to ask
    // does not depend on which host is awake.
    await waitFor(() => {
      const upload = fetchMock.mock.calls.find(
        ([, init]) => init?.method === 'POST',
      )
      expect(upload?.[0]).toContain('http://127.0.0.1:9001/blobs?doc=')
    })
  })

  it('reports an error rather than silently clearing the player', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unknown blob' }), {
          status: 404,
        }),
      ),
    )
    recording = {
      ...base,
      filepath: '',
      blob: { hash: HASH, size: 5, mimeType: 'audio/wav', ext: '.wav' },
    }

    renderPlayer({ type: 'web-client', worker: emptyWorker() }, [ENDPOINT])

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error'),
    )
  })

  it('has nothing to fall back on when there is no host and no local copy', async () => {
    recording = {
      ...base,
      filepath: '',
      blob: { hash: HASH, size: 5, mimeType: 'audio/wav', ext: '.wav' },
    }

    renderPlayer({ type: 'web-client', worker: emptyWorker() }, [])

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error'),
    )
  })
})

describe('switching between recordings', () => {
  const SECOND_URL = 'automerge:second' as AutomergeUrl
  const second: RecordingData = {
    ...base,
    url: SECOND_URL,
    filename: 'take-two',
    filepath: '',
    name: 'Take two',
    id: 'take-two',
    blob: { hash: 'b'.repeat(64), size: 5, mimeType: 'audio/wav', ext: '.wav' },
  }

  /** Loads the first recording, then swaps the player onto the second. */
  function SwitchingProbe() {
    const {
      audioRef,
      setCurrentSource,
      setCurrentUrl,
      isPlaying,
      setIsPlaying,
      playbackState,
    } = useAudioPlayer()
    const [src, setSrc] = useState('')

    useEffect(() => {
      setCurrentSource(base.filepath)
      setCurrentUrl(RECORDING_URL)
      setIsPlaying(true)
    }, [setCurrentSource, setCurrentUrl, setIsPlaying])

    useEffect(() => {
      const timer = setInterval(() => setSrc(audioRef.current?.src ?? ''), 5)
      return () => clearInterval(timer)
    }, [audioRef])

    return (
      <>
        <output data-testid="src">{src}</output>
        <output data-testid="state">{playbackState}</output>
        <output data-testid="playing">{String(isPlaying)}</output>
        <button
          onClick={() => {
            setCurrentSource(second.filepath)
            setCurrentUrl(SECOND_URL)
            setIsPlaying(true)
          }}
        >
          Play second
        </button>
      </>
    )
  }

  // TAP-83: the element kept the first recording's src while the second one
  // failed to resolve, so pressing play played the wrong tape under the new
  // recording's name.
  it('drops the previous recording rather than playing it in place of an unavailable one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 404 })),
    )
    recordings = {
      [RECORDING_URL]: {
        ...base,
        audio: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'audio/wav',
      },
      [SECOND_URL]: second,
    }

    render(
      <AppContextProvider value={{ type: 'web-client', worker: emptyWorker() }}>
        <BlobProvider endpoints={[ENDPOINT]}>
          <AudioPlayerProvider>
            <SwitchingProbe />
          </AudioPlayerProvider>
        </BlobProvider>
      </AppContextProvider>,
    )

    await waitFor(() => expect(srcText()).toMatch(/^blob:/))
    const firstSrc = srcText()

    fireEvent.click(screen.getByRole('button', { name: 'Play second' }))

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error'),
    )
    expect(srcText()).not.toBe(firstSrc)
    expect(srcText()).toBe('')
    // Nothing is loaded, so the transport must not sit in its playing state.
    expect(screen.getByTestId('playing')).toHaveTextContent('false')
  })
})

describe('electron', () => {
  it('serves a cached blob through the tapes-blob protocol', async () => {
    const send = vi.fn().mockResolvedValue({
      success: true,
      data: { present: true, size: 4, mimeType: 'audio/wav' },
    })
    recording = {
      ...base,
      blob: { hash: HASH, size: 4, mimeType: 'audio/wav', ext: '.wav' },
    }

    renderPlayer(electronContext(send), [ENDPOINT])

    await waitFor(() => expect(srcText()).toBe(`tapes-blob://${HASH}`))
  })

  it('falls back to the local file when the store does not have the blob', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ success: true, data: { present: false } })
    recording = {
      ...base,
      blob: { hash: HASH, size: 4, mimeType: 'audio/wav', ext: '.wav' },
    }

    renderPlayer(electronContext(send), [])

    await waitFor(() => expect(srcText()).toContain('tapes://take-one.wav'))
  })
})
