import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { AppContextProvider, type AppContextValue } from '@/context/AppContext'
import { BlobProvider } from '@/context/BlobContext'
import { PinProvider } from '@/context/PinContext'
import type { BlobEndpoint } from '@/blobClient'
import type { IpcService } from '@/IpcService'
import type { RecordingData, RecordingRepoState } from '@/types'
import { AggregatesProvider } from '@/context/AggregatesContext'
import { Library } from './Library'

const REPO_URL = 'automerge:repo' as AutomergeUrl
const RECORDING_URL = 'automerge:recording' as AutomergeUrl

const HASH = 'a'.repeat(64)
const ENDPOINT: BlobEndpoint = {
  baseUrl: 'http://127.0.0.1:9001',
  token: 'pair-token',
}

/** This device's own embedded host: the bytes are already on its disk. */
const LOCAL_ENDPOINT: BlobEndpoint = {
  baseUrl: 'http://127.0.0.1:9001',
  token: 'host-token',
  local: true,
}

/** A server the desktop app syncs with but does not host. */
const REMOTE_ENDPOINT: BlobEndpoint = {
  baseUrl: 'https://sync.example.com',
  token: 'pair-token',
}

const baseRecording: RecordingData = {
  url: RECORDING_URL,
  filename: 'take-one.wav',
  filepath: '/recordings/take-one.wav',
  name: 'Take one',
  duration: 4,
  id: 'take-one',
}

// Reassigned per test so the mocked useDocument can serve different shapes.
let recording: RecordingData = baseRecording

const withBlob = (): RecordingData => ({
  ...baseRecording,
  blob: { hash: HASH, size: 1024, mimeType: 'audio/wav', ext: '.wav' },
})

const webContext: AppContextValue = {
  type: 'web-client',
  worker: {} as unknown as Worker,
}

const electronContext = (send = vi.fn()): AppContextValue => ({
  type: 'electron-client',
  ipc: { send } as unknown as IpcService,
})

/**
 * A storage worker that answers every request successfully, echoing the
 * request id core's callWorker tags messages with. Enough for the cache writes
 * that pinning performs; the OPFS behaviour itself is the worker's own.
 */
const respondingWorker = (): Worker => {
  const postMessage = vi.fn()
  return {
    postMessage,
    addEventListener: (
      _type: string,
      listener: (event: MessageEvent) => void,
    ) => {
      queueMicrotask(() => {
        const sent = postMessage.mock.calls.at(-1)?.[0]
        listener(
          new MessageEvent('message', {
            data: {
              type: `${sent?.type}:response`,
              requestId: sent?.payload?.requestId,
              success: true,
              payload: {},
            },
          }),
        )
      })
    },
    removeEventListener: vi.fn(),
  } as unknown as Worker
}

// isValidAutomergeUrl gates whether Library passes the url to useDocument; the
// stub urls above aren't real Automerge urls, so force it true.
vi.mock('@automerge/automerge-repo', () => ({
  isValidAutomergeUrl: () => true,
}))

// Shared by both call sites (Library + LibraryListItem) so a test can assert
// that nothing wrote to the synced document.
const changeDocument = vi.fn()

// One repo doc holding a single recording, and the recording doc itself.
// Branch on the url so both call sites resolve.
vi.mock('@automerge/automerge-repo-react-hooks', () => ({
  useDocument: (url?: AutomergeUrl) => {
    if (url === REPO_URL) {
      return [
        { recordings: [RECORDING_URL] } as RecordingRepoState,
        changeDocument,
      ]
    }
    return [recording, changeDocument]
  },
}))

vi.mock('@/utils', () => ({
  useAutomergeUrl: () => ({ automergeUrl: REPO_URL }),
}))

vi.mock('@/context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    currentUrl: undefined,
    setCurrentSource: vi.fn(),
    setCurrentUrl: vi.fn(),
    setIsPlaying: vi.fn(),
  }),
}))

const renderLibrary = (
  appContext: AppContextValue = webContext,
  endpoints: readonly BlobEndpoint[] = [],
) =>
  render(
    <AppContextProvider value={appContext}>
      <BlobProvider endpoints={endpoints}>
        <PinProvider>
          <Library />
        </PinProvider>
      </BlobProvider>
    </AppContextProvider>,
  )

describe('LibraryListItem controls visibility (touch vs mouse)', () => {
  beforeEach(() => {
    cleanup()
    recording = baseRecording
  })

  // Both controls the fix touched. On a fine-pointer (mouse) screen they stay
  // hidden until hover; on a screen with no fine pointer (touch) they must be
  // visible at rest — which is the bug the fix addresses.
  const controls = ['Options', 'Play recording'] as const

  it.each(controls)(
    'the %s button is forced visible where there is no fine pointer',
    (title) => {
      renderLibrary()
      expect(screen.getByTitle(title)).toHaveClass('pointer-none:opacity-100')
    },
  )

  it.each(controls)(
    'the %s button stays hover-revealed on fine-pointer devices',
    (title) => {
      renderLibrary()
      expect(screen.getByTitle(title)).toHaveClass('pointer-fine:opacity-0')
    },
  )

  it.each(controls)(
    'the %s button carries no unconditional opacity-0 (regression guard)',
    (title) => {
      renderLibrary()
      const classes = screen.getByTitle(title).className.split(/\s+/)
      expect(classes).not.toContain('opacity-0')
    },
  )
})

describe('offline pinning', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    vi.unstubAllGlobals()
    recording = baseRecording
  })

  it('offers no pin control when the recording has no stored audio', async () => {
    renderLibrary(webContext, [ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))

    expect(screen.queryByText('Keep offline')).not.toBeInTheDocument()
  })

  it('offers no pin control when there is no host to fetch from', async () => {
    recording = withBlob()
    renderLibrary(webContext, [])
    await userEvent.click(screen.getByTitle('Options'))

    expect(screen.queryByText('Keep offline')).not.toBeInTheDocument()
  })

  // Every blob this device can fetch is already permanently on its own disk,
  // so a pin would promise nothing the desktop app doesn't already deliver.
  it('offers no pin control when the only host is this device itself', async () => {
    recording = withBlob()
    renderLibrary(electronContext(), [LOCAL_ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))

    expect(screen.queryByText('Keep offline')).not.toBeInTheDocument()
  })

  // But a desktop app syncing with a server it does not host can be looking at
  // bytes it does not have, which is a real reason to keep a copy.
  it('offers the pin control on the desktop app when a host other than this one holds the bytes', async () => {
    recording = withBlob()
    renderLibrary(electronContext(), [LOCAL_ENDPOINT, REMOTE_ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))

    expect(screen.getByText('Keep offline')).toBeInTheDocument()
  })

  it('downloads the audio and records the pin on this device', async () => {
    recording = withBlob()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('audio', { status: 200 })),
    )

    renderLibrary({ type: 'web-client', worker: respondingWorker() }, [
      ENDPOINT,
    ])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Keep offline'))

    await waitFor(() => {
      const pins = JSON.parse(localStorage.getItem('tapes.pins') ?? '{}')
      expect(pins).toHaveProperty(RECORDING_URL)
      expect(pins[RECORDING_URL].hash).toBe(HASH)
    })
  })

  // Pins are a fact about this device, not about the library. The mocked
  // useDocument hands every caller the same change fn, so if a pin ever wrote
  // to the doc it would show up here.
  it('never writes pin state into the synced document', async () => {
    recording = withBlob()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('audio', { status: 200 })),
    )

    renderLibrary({ type: 'web-client', worker: respondingWorker() }, [
      ENDPOINT,
    ])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Keep offline'))

    await waitFor(() =>
      expect(localStorage.getItem('tapes.pins')).not.toBeNull(),
    )
    expect(changeDocument).not.toHaveBeenCalled()
  })
})

describe('deleting', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    vi.unstubAllGlobals()
    recording = withBlob()
  })

  it('lets a web guest release the host copy of a recording it never made', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary(webContext, [ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain(`/blobs/${HASH}`)
    expect(init.method).toBe('DELETE')
  })

  it('sends the hash alongside the filepath so electron can reclaim the bytes', async () => {
    const send = vi.fn().mockResolvedValue({ success: true })

    renderLibrary(electronContext(send), [LOCAL_ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith('storage:delete-recording', {
      data: {
        filepath: '/recordings/take-one.wav',
        hash: HASH,
        docUrl: RECORDING_URL,
      },
    })
  })

  // The IPC delete above reaches only the embedded store, so a desktop app in
  // remote mode would otherwise leave its claim standing on the other host.
  it('also releases the claim on a host the desktop app does not run', async () => {
    const send = vi.fn().mockResolvedValue({ success: true })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary(electronContext(send), [LOCAL_ENDPOINT, REMOTE_ENDPOINT])
    await userEvent.click(screen.getByTitle('Options'))
    await userEvent.click(screen.getByText('Delete'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain(`https://sync.example.com/blobs/${HASH}`)
    expect(init.method).toBe('DELETE')
  })
})

describe('playback numbers on a row', () => {
  beforeEach(() => {
    cleanup()
    recording = baseRecording
    vi.unstubAllGlobals()
  })

  const renderWithHost = (fetchImpl: () => Promise<Response>) => {
    vi.stubGlobal('fetch', fetchImpl)
    return render(
      <AppContextProvider value={webContext}>
        <BlobProvider endpoints={[]}>
          <PinProvider>
            <AggregatesProvider
              target={{ kind: 'http', baseUrl: 'http://127.0.0.1:9001' }}
            >
              <Library />
            </AggregatesProvider>
          </PinProvider>
        </BlobProvider>
      </AppContextProvider>,
    )
  }

  const answering = (plays: number, averageCompletion: number) => () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          aggregates: [
            { recordingUrl: RECORDING_URL, plays, averageCompletion },
          ],
          generatedAt: '2026-09-05T10:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

  it('shows the numbers next to the duration once the host answers', async () => {
    renderWithHost(answering(12, 0.625))

    expect(
      await screen.findByText('12 plays · 63% complete on average'),
    ).toBeInTheDocument()
  })

  it('shows nothing rather than a zero when no host has answered', () => {
    renderLibrary()

    expect(screen.getByText('Plays unknown')).toBeInTheDocument()
  })
})
