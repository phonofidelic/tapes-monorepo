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
import {
  AudioPlayerProvider,
  useAudioPlayer,
  type PlaySession,
} from './AudioPlayerContext'
import type { BlobEndpoint } from '@/blobClient'
import type { IpcService } from '@/IpcService'
import type { RecordingData } from '@/types'
import { blobForObjectUrl } from '../../vitest.setup'

const RECORDING_URL = 'automerge:gQx8Jzznc3tEcPkc2p6rHzJids2' as AutomergeUrl
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
  const {
    audioRef,
    setCurrentSource,
    setCurrentUrl,
    playbackState,
    playbackFailure,
  } = useAudioPlayer()
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
      <output data-testid="failure">{playbackFailure ?? ''}</output>
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
  Reflect.deleteProperty(navigator, 'serviceWorker')
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

  it('fetches from the host once when nothing local has it', async () => {
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
    // Playing no longer fills the local cache. Pinning is the one way a
    // recording is kept for offline use.
    expect(sent).not.toContain('blob:put')
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
    // The host that was missing it is no longer repaired from here. Playback
    // may hold no bytes at all now, so pinning does the copying.
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
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

  /**
   * Every one of these used to reach the player as the same "not available
   * offline". Only the last is actually about being offline, and the first two
   * stay broken however long the user waits for the host to come back.
   */
  describe('saying which failure it was', () => {
    const withBlob = () => ({
      ...base,
      filepath: '',
      blob: { hash: HASH, size: 5, mimeType: 'audio/wav', ext: '.wav' },
    })

    it('distinguishes a recording whose audio never reached a host', async () => {
      recording = { ...base, filepath: '', blob: undefined }

      renderPlayer({ type: 'web-client', worker: emptyWorker() }, [ENDPOINT])

      await waitFor(() =>
        expect(screen.getByTestId('failure')).toHaveTextContent('not-uploaded'),
      )
    })

    it('distinguishes a device that is paired with nothing', async () => {
      recording = withBlob()

      renderPlayer({ type: 'web-client', worker: emptyWorker() }, [])

      await waitFor(() =>
        expect(screen.getByTestId('failure')).toHaveTextContent('unpaired'),
      )
    })

    it('distinguishes a host that no longer accepts our token', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
          }),
        ),
      )
      recording = withBlob()

      renderPlayer({ type: 'web-client', worker: emptyWorker() }, [ENDPOINT])

      await waitFor(() =>
        expect(screen.getByTestId('failure')).toHaveTextContent('unauthorized'),
      )
    })

    it('distinguishes a host that does not hold these bytes', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'Unknown blob' }), {
            status: 404,
          }),
        ),
      )
      recording = withBlob()

      renderPlayer({ type: 'web-client', worker: emptyWorker() }, [ENDPOINT])

      await waitFor(() =>
        expect(screen.getByTestId('failure')).toHaveTextContent('missing'),
      )
    })

    it('distinguishes a host that cannot be reached at all', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      )
      recording = withBlob()

      renderPlayer({ type: 'web-client', worker: emptyWorker() }, [ENDPOINT])

      await waitFor(() =>
        expect(screen.getByTestId('failure')).toHaveTextContent('unreachable'),
      )
    })
  })
})

/** A host on the page's own origin, which the service worker can authenticate. */
const ORIGIN_ENDPOINT: BlobEndpoint = {
  baseUrl: window.location.origin,
  token: 'pair-token',
}

/**
 * Stands in for the worker the host-served bundle registers. Only its presence
 * matters to the player; adding the header is the worker's own job.
 */
const controlPage = () => {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { controller: {} },
    configurable: true,
  })
}

/** A host answering HEAD for a blob it holds. */
const held = () =>
  new Response(null, {
    status: 200,
    headers: { 'content-length': '5000000', 'content-type': 'audio/wav' },
  })

const notHeld = () =>
  new Response(JSON.stringify({ error: 'Unknown blob' }), { status: 404 })

/** A long recording, which is the case streaming exists for. */
const longRecording = (): RecordingData => ({
  ...base,
  filepath: '',
  blob: { hash: HASH, size: 5000000, mimeType: 'audio/wav', ext: '.wav' },
})

describe('streaming from the host', () => {
  it('points the element at the host rather than buffering the file', async () => {
    controlPage()
    const fetchMock = vi.fn().mockResolvedValue(held())
    vi.stubGlobal('fetch', fetchMock)
    recording = longRecording()

    const sent: string[] = []
    const worker = workerAnswering((message) => {
      sent.push(message.type)
      return { success: false, error: 'NotFoundError' }
    })
    renderPlayer({ type: 'web-client', worker }, [ORIGIN_ENDPOINT])

    await waitFor(() =>
      expect(srcText()).toBe(`${window.location.origin}/blobs/${HASH}`),
    )
    // One HEAD and nothing else. The body arrives through the element, which
    // range-requests it, so none of it passes through here.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('HEAD')
    expect(sent).not.toContain('blob:put')
  })

  it('buffers the whole file when no worker is controlling the page', async () => {
    // Registration needs a secure context, which the plain-HTTP LAN mode is
    // not. Those guests keep the old path.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('audio', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    recording = longRecording()

    renderPlayer({ type: 'web-client', worker: emptyWorker() }, [
      ORIGIN_ENDPOINT,
    ])

    await waitFor(() => expect(srcText()).toMatch(/^blob:/))
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
  })

  it('streams from the next host when the nearest one has never seen the blob', async () => {
    controlPage()
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith(window.location.origin) ? held() : notHeld(),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    recording = longRecording()

    renderPlayer({ type: 'web-client', worker: emptyWorker() }, [
      { ...ENDPOINT, local: true },
      ORIGIN_ENDPOINT,
    ])

    await waitFor(() =>
      expect(srcText()).toBe(`${window.location.origin}/blobs/${HASH}`),
    )
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://127.0.0.1:9001/blobs/${HASH}`,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('buffers from a host the worker cannot authenticate for', async () => {
    // The worker adds the token to its own origin only. A remote host still
    // needs the page to fetch the bytes and set the header itself.
    controlPage()
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!url.startsWith(REMOTE_ENDPOINT.baseUrl)) {
        return Promise.resolve(notHeld())
      }
      return Promise.resolve(
        init?.method === 'HEAD'
          ? held()
          : new Response('audio', { status: 200 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    recording = longRecording()

    renderPlayer({ type: 'web-client', worker: emptyWorker() }, [
      ORIGIN_ENDPOINT,
      REMOTE_ENDPOINT,
    ])

    await waitFor(() => expect(srcText()).toMatch(/^blob:/))
    const body = fetchMock.mock.calls.find(([, init]) => !init?.method)
    expect(body?.[0]).toBe(`https://sync.example.com/blobs/${HASH}`)
  })

  it('reports a host that rejects the probe', async () => {
    controlPage()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    )
    recording = longRecording()

    renderPlayer({ type: 'web-client', worker: emptyWorker() }, [
      ORIGIN_ENDPOINT,
    ])

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('error'),
    )
    expect(screen.getByTestId('failure')).toHaveTextContent('unauthorized')
  })
})

describe('switching between recordings', () => {
  const SECOND_URL = 'automerge:221YRU7jTAFpMoKT7tzB4yK7fZ8s' as AutomergeUrl
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
    // `src` is a sample of the element taken by the probe's poller, not a
    // React value, so it lags the failure it is being read against by up to a
    // tick — long enough on a loaded machine to still be showing the first
    // recording. Wait for the sample rather than reading one snapshot of it.
    await waitFor(() => expect(srcText()).toBe(''))
    expect(srcText()).not.toBe(firstSrc)
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

  it('adds a recording that predates the store, then plays it by hash', async () => {
    const send = ipcAnswering({ present: false })
    // No descriptor at all: a document written before audio moved out of band.
    recording = base

    renderPlayer(electronContext(send), [])

    await waitFor(() => expect(srcText()).toBe(`tapes-blob://${HASH}`))
    expect(send).toHaveBeenCalledWith('blob:put-file', {
      data: { filepath: 'take-one.wav', docUrl: RECORDING_URL },
    })
  })

  it('re-adds the local file when the store has lost the bytes', async () => {
    const send = ipcAnswering({ present: false })
    recording = {
      ...base,
      blob: { hash: HASH, size: 4, mimeType: 'audio/wav', ext: '.wav' },
    }

    renderPlayer(electronContext(send), [])

    await waitFor(() => expect(srcText()).toBe(`tapes-blob://${HASH}`))
  })

  it('reports the recording as not uploaded when the store rejects it', async () => {
    const send = vi.fn().mockImplementation((channel: string) =>
      channel === 'blob:put-file'
        ? Promise.resolve({
            success: false,
            error: new Error('Blob store is not available'),
          })
        : Promise.resolve({ success: true, data: { present: false } }),
    )
    recording = base

    renderPlayer(electronContext(send), [])

    await waitFor(() =>
      expect(screen.getByTestId('failure')).toHaveTextContent('not-uploaded'),
    )
  })
})

/**
 * An electron IPC stub. Ingesting always succeeds and returns the one
 * descriptor these tests use; every other channel gets `data`.
 */
function ipcAnswering(data: unknown) {
  return vi.fn().mockImplementation((channel: string) =>
    channel === 'blob:put-file'
      ? Promise.resolve({
          success: true,
          data: { hash: HASH, size: 4, mimeType: 'audio/wav', ext: '.wav' },
        })
      : Promise.resolve({ success: true, data }),
  )
}

/**
 * Exposes the transport itself: the element the provider plays through, the
 * time the UI would show, and the seek the transport bar calls.
 */
function TransportProbe() {
  const { audioRef, currentTime, seekableDuration, seek } = useAudioPlayer()
  const [element, setElement] = useState<HTMLAudioElement | null>(null)

  useEffect(() => {
    setElement(audioRef.current)
  }, [audioRef])

  useEffect(() => {
    audioElement = element
  }, [element])

  return (
    <>
      <output data-testid="time">{currentTime}</output>
      <output data-testid="seekable">{seekableDuration}</output>
      <button onClick={() => seek(2)}>Seek to 2</button>
      <button onClick={() => seek(9999)}>Seek past the end</button>
    </>
  )
}

let audioElement: HTMLAudioElement | null = null

/** Read through a call so the reset in `renderTransport` doesn't narrow it. */
const currentAudioElement = () => audioElement

/** jsdom gives a media element no metadata, so state the length outright. */
const setDuration = (audio: HTMLAudioElement, duration: number) => {
  Object.defineProperty(audio, 'duration', {
    value: duration,
    configurable: true,
  })
  fireEvent(audio, new Event('durationchange'))
}

const renderTransport = () => {
  audioElement = null
  render(
    <AppContextProvider value={{ type: 'web-client', worker: emptyWorker() }}>
      <BlobProvider endpoints={[]}>
        <AudioPlayerProvider>
          <TransportProbe />
        </AudioPlayerProvider>
      </BlobProvider>
    </AppContextProvider>,
  )
  const audio = currentAudioElement()
  if (!audio) {
    throw new Error('the provider never exposed its audio element')
  }
  return audio
}

describe('seeking', () => {
  it('moves the element and the transport together', async () => {
    const audio = renderTransport()
    setDuration(audio, 10)

    fireEvent.click(screen.getByRole('button', { name: 'Seek to 2' }))

    expect(audio.currentTime).toBe(2)
    await waitFor(() =>
      expect(screen.getByTestId('time')).toHaveTextContent('2'),
    )
  })

  it('clamps a seek past the end', () => {
    const audio = renderTransport()
    setDuration(audio, 10)

    fireEvent.click(screen.getByRole('button', { name: 'Seek past the end' }))

    expect(audio.currentTime).toBe(10)
  })

  it('does nothing while the length is unknown', () => {
    // What a MediaRecorder-written mp4 reports until it has been played
    // through, and a fraction of it means nothing.
    const audio = renderTransport()
    setDuration(audio, Infinity)

    expect(screen.getByTestId('seekable')).toHaveTextContent('0')

    fireEvent.click(screen.getByRole('button', { name: 'Seek to 2' }))

    expect(audio.currentTime).toBe(0)
  })

  it('reports the end of a tape where the element actually is', async () => {
    const audio = renderTransport()
    setDuration(audio, 10)

    fireEvent(audio, new Event('ended'))

    // The transport used to report 0 here while the element sat at the end, so
    // the next seek started from somewhere the UI never showed.
    expect(audio.currentTime).toBe(10)
    await waitFor(() =>
      expect(screen.getByTestId('time')).toHaveTextContent('10'),
    )
  })
})

/** The player's element, alongside what it reports about playback. */
function MediaProbe() {
  const {
    audioRef,
    setCurrentSource,
    setCurrentUrl,
    playbackState,
    playbackFailure,
  } = useAudioPlayer()

  useEffect(() => {
    audioElement = audioRef.current
  }, [audioRef])

  useEffect(() => {
    setCurrentSource(base.filepath)
    setCurrentUrl(RECORDING_URL)
  }, [setCurrentSource, setCurrentUrl])

  return (
    <>
      <output data-testid="state">{playbackState}</output>
      <output data-testid="failure">{playbackFailure ?? ''}</output>
    </>
  )
}

const renderMedia = () => {
  audioElement = null
  render(
    <AppContextProvider value={{ type: 'web-client', worker: emptyWorker() }}>
      <BlobProvider endpoints={[]}>
        <AudioPlayerProvider>
          <MediaProbe />
        </AudioPlayerProvider>
      </BlobProvider>
    </AppContextProvider>,
  )
  const audio = currentAudioElement()
  if (!audio) {
    throw new Error('the provider never exposed its audio element')
  }
  return audio
}

describe('media errors', () => {
  beforeEach(() => {
    // Resolves without a host, so these tests are about the element alone.
    recording = { ...base, audio: new Uint8Array([1, 2, 3]) }
  })

  // A streamed source is fetched by the element over the whole of playback, so
  // it can fail long after it was handed over. That used to be logged and
  // nothing else, leaving a play button over a source that would never play.
  it('reports a source that fails after it was handed over', async () => {
    const audio = renderMedia()
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('ready'),
    )

    fireEvent(audio, new Event('error'))

    expect(screen.getByTestId('state')).toHaveTextContent('error')
    expect(screen.getByTestId('failure')).toHaveTextContent('unreachable')
  })

  it('ignores an error from a source already detached', async () => {
    const audio = renderMedia()
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('ready'),
    )

    // What the element reports while the player swaps recordings. Treating it
    // as a failure would blame the new recording for the old one going away.
    cleanup()
    fireEvent(audio, new Event('error'))

    renderMedia()
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('ready'),
    )
  })
})

/**
 * Drives a play session end to end: what starts and stops playback, and the
 * seeks that must not read as listening.
 */
function SessionProbe({ url = RECORDING_URL }: { url?: AutomergeUrl }) {
  const { audioRef, setCurrentSource, setCurrentUrl, setIsPlaying, seek } =
    useAudioPlayer()

  useEffect(() => {
    audioElement = audioRef.current
  }, [audioRef])

  useEffect(() => {
    setCurrentSource(base.filepath)
    setCurrentUrl(url)
  }, [url, setCurrentSource, setCurrentUrl])

  return (
    <>
      <button onClick={() => setIsPlaying(true)}>Play</button>
      <button onClick={() => setIsPlaying(false)}>Pause</button>
      <button onClick={() => seek(0)}>Seek to start</button>
      <button onClick={() => seek(9)}>Seek near the end</button>
    </>
  )
}

const sessionTree = (
  onPlaySession: (session: PlaySession) => void,
  url: AutomergeUrl,
) => (
  <AppContextProvider value={{ type: 'web-client', worker: emptyWorker() }}>
    <BlobProvider endpoints={[]}>
      <AudioPlayerProvider onPlaySession={onPlaySession}>
        <SessionProbe url={url} />
      </AudioPlayerProvider>
    </BlobProvider>
  </AppContextProvider>
)

const renderSession = (
  onPlaySession: (session: PlaySession) => void,
  url: AutomergeUrl = RECORDING_URL,
) => {
  audioElement = null
  const view = render(sessionTree(onPlaySession, url))
  const audio = currentAudioElement()
  if (!audio) {
    throw new Error('the provider never exposed its audio element')
  }
  return { ...view, audio }
}

const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }))

/** Plays through `seconds`, one `timeupdate` per second as an element would. */
const playThrough = (audio: HTMLAudioElement, ...seconds: number[]) => {
  for (const second of seconds) {
    audio.currentTime = second
    fireEvent(audio, new Event('timeupdate'))
  }
}

/** The session the player reported, which every test here asserts on. */
const reported = (onPlaySession: ReturnType<typeof vi.fn>): PlaySession =>
  onPlaySession.mock.calls[0][0] as PlaySession

describe('play sessions', () => {
  beforeEach(() => {
    // The embedded-audio path resolves without a worker or a host, so these
    // tests are about the measurement and nothing else.
    recording = { ...base, audio: new Uint8Array([1, 2, 3]) }
    recordings = {}
  })

  it('reports the furthest point reached once a play passes five seconds', async () => {
    const onPlaySession = vi.fn()
    const { audio } = renderSession(onPlaySession)
    setDuration(audio, 10)

    click('Play')
    playThrough(audio, 1, 2, 3, 4, 5, 6)
    click('Pause')

    await waitFor(() => expect(onPlaySession).toHaveBeenCalledTimes(1))
    expect(reported(onPlaySession).recordingUrl).toBe(RECORDING_URL)
    expect(reported(onPlaySession).completion).toBeCloseTo(0.6)
    expect(Date.parse(reported(onPlaySession).occurredAt)).not.toBeNaN()
  })

  it('ignores a play too short to be listening', async () => {
    const onPlaySession = vi.fn()
    const { audio } = renderSession(onPlaySession)
    setDuration(audio, 10)

    // A mis-tap, a preview, a few seconds of a tape: counting these inflates
    // the play count for exactly the recordings nobody sat through.
    click('Play')
    playThrough(audio, 1, 2, 3)
    click('Pause')

    await waitFor(() => expect(screen.getByText('Play')).toBeInTheDocument())
    expect(onPlaySession).not.toHaveBeenCalled()
  })

  it('does not count a seek across the tape as listening', async () => {
    const onPlaySession = vi.fn()
    const { audio } = renderSession(onPlaySession)
    setDuration(audio, 10)

    click('Play')
    playThrough(audio, 1)
    // Eight seconds of transport in one step, and none of it heard.
    click('Seek near the end')
    playThrough(audio, 9.5)
    click('Pause')

    await waitFor(() => expect(screen.getByText('Play')).toBeInTheDocument())
    expect(onPlaySession).not.toHaveBeenCalled()
  })

  it('takes the maximum progress reached, not the time listened', async () => {
    const onPlaySession = vi.fn()
    const { audio } = renderSession(onPlaySession)
    setDuration(audio, 10)

    click('Play')
    playThrough(audio, 1, 2, 3, 4, 5, 6)
    // Re-listening to the opening is nine seconds of playback in total, which
    // as a fraction of a ten-second tape would read as 90% of it heard.
    click('Seek to start')
    playThrough(audio, 1, 2, 3)
    click('Pause')

    await waitFor(() => expect(onPlaySession).toHaveBeenCalledTimes(1))
    expect(reported(onPlaySession).completion).toBeCloseTo(0.6)
  })

  it('reads a tape played out as complete', async () => {
    const onPlaySession = vi.fn()
    const { audio } = renderSession(onPlaySession)
    setDuration(audio, 10)

    click('Play')
    playThrough(audio, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9.8)
    // The last `timeupdate` always lands short of the end.
    fireEvent(audio, new Event('ended'))

    await waitFor(() => expect(onPlaySession).toHaveBeenCalledTimes(1))
    expect(reported(onPlaySession).completion).toBe(1)
  })

  it('drops a session when no finite length is addressable', async () => {
    const onPlaySession = vi.fn()
    const { audio } = renderSession(onPlaySession)
    // What a MediaRecorder-written mp4 reports until it has been played
    // through. A percentage of it would be invented, and an invented number is
    // worse than a missing play.
    setDuration(audio, Infinity)

    click('Play')
    playThrough(audio, 1, 2, 3, 4, 5, 6)
    click('Pause')

    await waitFor(() => expect(screen.getByText('Play')).toBeInTheDocument())
    expect(onPlaySession).not.toHaveBeenCalled()
  })

  it('flushes the session when the player unmounts', async () => {
    const onPlaySession = vi.fn()
    const { audio, unmount } = renderSession(onPlaySession)
    setDuration(audio, 10)

    click('Play')
    playThrough(audio, 1, 2, 3, 4, 5, 6)
    // How most plays end: the user navigates away mid-tape.
    unmount()

    await waitFor(() => expect(onPlaySession).toHaveBeenCalledTimes(1))
    expect(reported(onPlaySession).completion).toBeCloseTo(0.6)
  })

  it('flushes the session when the recording changes', async () => {
    const OTHER_URL = 'automerge:3wFgAui1PiffnAueEdkvhm6mZaSd' as AutomergeUrl
    recordings = {
      [RECORDING_URL]: recording,
      [OTHER_URL]: { ...recording, url: OTHER_URL, id: 'take-two' },
    }
    const onPlaySession = vi.fn()
    const { audio, rerender } = renderSession(onPlaySession)
    setDuration(audio, 10)

    click('Play')
    playThrough(audio, 1, 2, 3, 4, 5, 6)

    rerender(sessionTree(onPlaySession, OTHER_URL))

    await waitFor(() => expect(onPlaySession).toHaveBeenCalledTimes(1))
    expect(reported(onPlaySession).recordingUrl).toBe(RECORDING_URL)
    expect(reported(onPlaySession).completion).toBeCloseTo(0.6)
  })
})
