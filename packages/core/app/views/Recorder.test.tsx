import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { AppContextProvider } from '@/context/AppContext'
import { BlobProvider } from '@/context/BlobContext'
import { SettingsProvider } from '@/context/SettingsContext'
import type { BlobEndpoint } from '@/blobClient'
import type { RecordingData } from '@/types'
import { Recorder } from './Recorder'

const REPO_URL = 'automerge:repo' as AutomergeUrl
const RECORDING_URL = 'automerge:recording' as AutomergeUrl
const HASH = 'a'.repeat(64)
const ENDPOINT: BlobEndpoint = {
  baseUrl: 'http://127.0.0.1:9001',
  token: 'pair-token',
}
const RECORDED_FILE = 'take-one.webm'

/** Every change applied to the recording doc, in order. */
let documentWrites: Partial<RecordingData>[] = []
const changeRepoState = vi.fn()

const handle = {
  url: RECORDING_URL,
  change: (mutate: (doc: Partial<RecordingData>) => void) => {
    const draft: Partial<RecordingData> = {}
    mutate(draft)
    documentWrites.push(draft)
  },
}

// Nothing in the suite mocks useRepo today; the recorder is the first thing
// that creates documents rather than just reading them.
vi.mock('@automerge/automerge-repo-react-hooks', () => ({
  useRepo: () => ({
    create: () => handle,
    find: async () => handle,
  }),
  useDocument: () => [{ recordings: [] }, changeRepoState],
}))

vi.mock('@automerge/automerge-repo', () => ({
  isValidAutomergeUrl: () => true,
}))

vi.mock('@/utils', () => ({
  useAutomergeUrl: () => ({ automergeUrl: REPO_URL }),
  getAudioStream: vi.fn(),
}))

// A stopped recording whose bytes are already on this device.
vi.mock('@/context/RecordingContext', () => ({
  useRecorder: () => ({
    time: 4,
    isRecording: true,
    handleFilename: RECORDED_FILE,
    setIsRecording: vi.fn(),
  }),
  RecordingStateProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}))

vi.mock('@/components/AudioInputSelector', () => ({
  AudioInputSelector: () => null,
}))
vi.mock('@/components/AudioVisualizer', () => ({
  AudioVisualizer: () => null,
}))

const recordedFile = () =>
  new File(['audio'], RECORDED_FILE, { type: 'audio/webm' })

/**
 * A storage worker that hands back the just-recorded OPFS file. The upload
 * path asks for it before it can send anything, so a worker that never answers
 * would stall every test here rather than exercising it.
 */
const workerWithFile = (file: File): Worker => {
  const listeners = new Set<(event: MessageEvent) => void>()
  return {
    postMessage: (message: {
      type: string
      payload: Record<string, unknown>
    }) => {
      queueMicrotask(() => {
        listeners.forEach((listener) =>
          listener(
            new MessageEvent('message', {
              data: {
                type: `${message.type}:response`,
                requestId: message.payload?.requestId,
                success: true,
                payload: { file },
              },
            }),
          ),
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

const renderRecorder = (endpoint?: BlobEndpoint, file = recordedFile()) =>
  render(
    <AppContextProvider
      value={{ type: 'web-client', worker: workerWithFile(file) }}
    >
      <SettingsProvider>
        <BlobProvider endpoints={endpoint ? [endpoint] : []}>
          <Recorder />
        </BlobProvider>
      </SettingsProvider>
    </AppContextProvider>,
  )

/** Stops the in-progress recording, then saves it. */
async function saveRecording() {
  await userEvent.click(screen.getByTitle('Stop recording'))
  await userEvent.click(screen.getByTitle('Save recording'))
}

// jsdom has no Web Audio; the monitor builds an analyser as soon as an input
// device is selected. None of it affects saving.
class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteFrequencyData: vi.fn(),
      getByteTimeDomainData: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() }
  }
  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } }
  }
  close() {
    return Promise.resolve()
  }
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  vi.stubGlobal('AudioContext', FakeAudioContext)
  // The record button only renders once an input device has been chosen.
  // audioChannelCount and audioFormat have to be seeded too: without them
  // readSettingsFromLocalStorage returns only its own defaults and drops
  // everything else.
  localStorage.setItem(
    'settings',
    JSON.stringify({
      audioInputDeviceId: 'default',
      audioChannelCount: '1',
      audioFormat: 'webm',
    }),
  )
  documentWrites = []
  changeRepoState.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saving a recording', () => {
  it('writes metadata only — never the audio bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            hash: HASH,
            size: 12,
            mimeType: 'audio/webm',
            ext: '.webm',
          }),
          { status: 201 },
        ),
      ),
    )

    renderRecorder(ENDPOINT)
    await saveRecording()

    await waitFor(() => expect(documentWrites.length).toBeGreaterThan(0))
    const created = documentWrites[0]
    expect(created).toMatchObject({
      filepath: RECORDED_FILE,
      name: 'New recording',
      duration: 4,
    })
    // The whole point of the change: no bytes in the document, at any size.
    expect(created).not.toHaveProperty('audio')
    expect(created).not.toHaveProperty('mimeType')
    // And the recording is in the library immediately, before any upload.
    expect(changeRepoState).toHaveBeenCalled()
  })

  it('records where the audio landed once the host has it', async () => {
    const file = recordedFile()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hash: HASH,
          size: 5,
          mimeType: 'audio/webm',
          ext: '.webm',
        }),
        { status: 201 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderRecorder(ENDPOINT, file)
    await saveRecording()

    await waitFor(() =>
      expect(documentWrites.some((write) => write.blob)).toBe(true),
    )
    expect(documentWrites.find((write) => write.blob)?.blob).toEqual({
      hash: HASH,
      size: 5,
      mimeType: 'audio/webm',
      ext: '.webm',
    })
    // The upload streams the OPFS File itself rather than a buffer.
    expect(fetchMock.mock.calls[0][1].body).toBe(file)
    expect(localStorage.getItem('tapes.pendingBlobUploads')).toBe('[]')
  })

  it('still saves, and queues a retry, when the upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    renderRecorder(ENDPOINT)
    await saveRecording()

    await waitFor(() => expect(documentWrites.length).toBeGreaterThan(0))
    expect(changeRepoState).toHaveBeenCalled()
    await waitFor(() => {
      const pending = JSON.parse(
        localStorage.getItem('tapes.pendingBlobUploads') ?? '[]',
      )
      expect(pending).toEqual([
        { docUrl: RECORDING_URL, filepath: RECORDED_FILE },
      ])
    })
  })

  // A standalone web client has no host at all. Recording must still work.
  it('queues the upload when there is nowhere to send it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderRecorder(undefined)
    await saveRecording()

    await waitFor(() => expect(documentWrites.length).toBeGreaterThan(0))
    expect(fetchMock).not.toHaveBeenCalled()
    await waitFor(() => {
      const pending = JSON.parse(
        localStorage.getItem('tapes.pendingBlobUploads') ?? '[]',
      )
      expect(pending).toHaveLength(1)
    })
  })
})
