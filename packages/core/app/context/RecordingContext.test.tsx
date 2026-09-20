import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { AppContextProvider } from '@/context/AppContext'
import { getAudioStream } from '@/utils'
import { RecordingStateProvider } from './RecordingContext'

vi.mock('@/utils', () => ({ getAudioStream: vi.fn() }))

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

/** Records the calls the context makes, in order. */
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

/** A worker the test drives directly, standing in for the OPFS worker. */
const fakeWorker = () => {
  const listeners = new Set<(event: MessageEvent) => void>()
  const worker = {
    postMessage: vi.fn(),
    addEventListener: (_type: string, listener: (e: MessageEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (e: MessageEvent) => void) =>
      listeners.delete(listener),
  } as unknown as Worker

  const emit = async (data: unknown) => {
    await act(async () => {
      listeners.forEach((listener) =>
        listener(new MessageEvent('message', { data })),
      )
    })
  }

  return { worker, emit }
}

const renderProvider = (worker: Worker) =>
  render(
    <AppContextProvider value={{ type: 'web-client', worker }}>
      <RecordingStateProvider>
        <div />
      </RecordingStateProvider>
    </AppContextProvider>,
  )

const START = {
  type: 'recorder:start:response',
  payload: { filename: 'a.wav' },
}
const STOP = { type: 'recorder:stop:response', payload: {} }

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  recorders.length = 0
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RecordingStateProvider', () => {
  it('stops the recorder when the stop message follows a completed start', async () => {
    const { stream, track } = fakeStream()
    vi.mocked(getAudioStream).mockResolvedValue(stream)
    const { worker, emit } = fakeWorker()
    renderProvider(worker)

    await emit(START)
    await waitFor(() => expect(recorders[0]?.started).toBe(true))

    await emit(STOP)

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
    const { worker, emit } = fakeWorker()
    renderProvider(worker)

    await emit(START)
    // The stop lands first: there is no recorder yet.
    await emit(STOP)
    expect(recorders).toHaveLength(0)

    await act(async () => {
      openMicrophone(stream)
    })

    await waitFor(() => expect(recorders).toHaveLength(1))
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
    const { worker, emit } = fakeWorker()
    renderProvider(worker)

    await emit(START)

    await waitFor(() => expect(track.stopped).toBe(true))
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to start recording:',
      expect.any(Error),
    )
  })
})
