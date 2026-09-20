import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { AppContextProvider } from '@/context/AppContext'
import { getAudioStream } from '@/utils'
import { callWorker } from '@/workerClient'
import { RecordingStateProvider, useRecorder } from './RecordingContext'

vi.mock('@/utils', () => ({ getAudioStream: vi.fn() }))
vi.mock('@/workerClient', () => ({ callWorker: vi.fn() }))

vi.mock('./SettingsContext', () => ({
  useSetting: () => ['device-a', vi.fn()],
}))

/** A microphone track that records whether it was released. */
class FakeTrack {
  stopped = false
  stop() {
    this.stopped = true
  }
}

const fakeStream = () => {
  const track = new FakeTrack()
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream,
  }
}

/** Every recorder the context constructed, in order. */
const recorders: FakeMediaRecorder[] = []

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = () => true
  started = false
  stopped = false

  constructor(readonly stream: MediaStream) {
    super()
    recorders.push(this)
  }

  start() {
    this.started = true
  }

  stop() {
    this.stopped = true
    // A real recorder flushes its last chunk and fires `stop` asynchronously.
    queueMicrotask(() => this.dispatchEvent(new Event('stop')))
  }
}

/** The two callbacks under test, reached through the context. */
type Controls = {
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
}

const renderProvider = () => {
  const controls = {} as Controls

  const Probe = () => {
    const { startRecording, stopRecording } = useRecorder()
    controls.startRecording = startRecording
    controls.stopRecording = stopRecording
    return null
  }

  render(
    <AppContextProvider
      value={{
        type: 'web-client',
        worker: { postMessage: vi.fn() } as unknown as Worker,
      }}
    >
      <RecordingStateProvider>
        <Probe />
      </RecordingStateProvider>
    </AppContextProvider>,
  )

  return controls
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  recorders.length = 0
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.mocked(callWorker).mockResolvedValue({ filename: 'a.wav' })
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RecordingStateProvider', () => {
  it('stops the recorder when stop follows a completed start', async () => {
    const { stream, track } = fakeStream()
    vi.mocked(getAudioStream).mockResolvedValue(stream)
    const controls = renderProvider()

    await act(async () => {
      await controls.startRecording()
    })
    expect(recorders[0].started).toBe(true)

    await act(async () => {
      await controls.stopRecording()
    })

    expect(recorders[0].stopped).toBe(true)
    await waitFor(() => expect(track.stopped).toBe(true))
  })

  // TAP-81. Opening the microphone can take seconds, and the stop used to be
  // dropped with "mediaRecorderRef.current is null": the recorder was left
  // running, the mic stayed open and the worker's file was never written.
  it('stops a recorder whose microphone was still opening when stop arrived', async () => {
    const { stream, track } = fakeStream()
    let openMicrophone: (stream: MediaStream) => void = () => {}
    vi.mocked(getAudioStream).mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        openMicrophone = resolve
      }),
    )
    const controls = renderProvider()

    let starting: Promise<void> = Promise.resolve()
    await act(async () => {
      starting = controls.startRecording()
    })

    // The stop lands first: there is no recorder yet.
    await act(async () => {
      await controls.stopRecording()
    })
    expect(recorders).toHaveLength(0)

    await act(async () => {
      openMicrophone(stream)
      await starting
    })

    expect(recorders).toHaveLength(1)
    // Started and then stopped, so the file the worker opened gets its bytes.
    expect(recorders[0].started).toBe(true)
    expect(recorders[0].stopped).toBe(true)
    await waitFor(() => expect(track.stopped).toBe(true))
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('releases the microphone when the recorder cannot be constructed', async () => {
    const { stream, track } = fakeStream()
    vi.mocked(getAudioStream).mockResolvedValue(stream)
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported = () => true
        constructor() {
          throw new Error('no recorder')
        }
      },
    )
    const controls = renderProvider()

    await act(async () => {
      await controls.startRecording()
    })

    expect(track.stopped).toBe(true)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to create the recorder:',
      expect.any(Error),
    )
  })
})
