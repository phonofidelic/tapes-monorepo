import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAppContext } from './AppContext'
import { getAudioStream } from '@/utils'
import { useSetting } from './SettingsContext'
import { callWorker } from '@/workerClient'
import { recordingMimeType } from '@/blobUpload'

const RecordingContext = createContext<{
  isRecording: boolean
  time: number
  handleFilename: string | null
  setIsRecording: (state: boolean) => void
  startRecording: () => Promise<void>
  /** Resolves with the encoded signed claim, when one could be made. */
  stopRecording: () => Promise<string | undefined>
} | null>(null)

export const RecordingStateProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const appContext = useAppContext()
  const [audioInputDeviceId] = useSetting('audioInputDeviceId')
  const [audioFormat] = useSetting('audioFormat')
  const [isRecording, setIsRecording] = useState(false)
  const [time, setTime] = useState(0)
  const [handleFilename, setHandleFilename] = useState<string | null>(null)
  // The active recorder must survive a re-render between the start and stop
  // calls, so it lives in a ref rather than in state.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  // Opening the microphone can take seconds, so a stop can arrive before there
  // is a recorder to stop. These two carry that stop between the callbacks
  // below.
  const isStartingRef = useRef(false)
  const stopRequestedRef = useRef(false)
  // What the claim needs to know about the recording in progress.
  const takeRef = useRef<{ filename: string; startedAt: string } | null>(null)

  useEffect(() => {
    if (!isRecording) {
      return
    }
    const start = Date.now()
    const interval = setInterval(() => {
      setTime(Date.now() - start)
    }, 10)

    return () => {
      clearInterval(interval)
    }
  }, [isRecording])

  /**
   * Stops the recorder and releases the microphone.
   *
   * Stopping fires one last chunk event, so the chunk listener must stay
   * attached. The tracks are released after the recorder has stopped.
   *
   * Resolves on the `stop` event. By then the last chunk has been posted to
   * the worker, so a message sent after it reaches the worker after the chunk.
   */
  const stopRecorder = useCallback((recorder: MediaRecorder) => {
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          recorder.stream.getTracks().forEach((track) => track.stop())
          resolve()
        },
        { once: true },
      )
    })
    recorder.stop()
    mediaRecorderRef.current = null
    return stopped
  }, [])

  /**
   * Opens the OPFS file, then the microphone, then starts the recorder. Only
   * the web client records this way; on electron the main process owns the
   * whole thing and the Recorder view drives it over IPC.
   */
  const startRecording = useCallback(async () => {
    if (appContext.type !== 'web-client') {
      return
    }
    const { worker } = appContext
    setIsRecording(true)
    isStartingRef.current = true
    stopRequestedRef.current = false

    try {
      let filename: string
      try {
        const reply = await callWorker<{ filename: string }>(
          worker,
          'recorder:start',
          { audioFormat, audioInputDeviceId },
        )
        filename = reply.filename
      } catch (error) {
        // Without this the UI stays in the recording state with no recorder.
        console.error('Failed to start recording:', error)
        setIsRecording(false)
        return
      }
      setHandleFilename(filename)

      let audioStream: MediaStream
      try {
        audioStream = await getAudioStream(audioInputDeviceId ?? '')
      } catch (error) {
        console.error('Failed to open the audio input:', error)
        setIsRecording(false)
        return
      }

      let recorder: MediaRecorder
      try {
        recorder = await getMediaRecorder(audioStream)
      } catch (error) {
        // Otherwise this rejects with nothing to catch it. The microphone
        // would stay open while the UI still showed a recording in progress.
        console.error('Failed to create the recorder:', error)
        audioStream.getTracks().forEach((track) => track.stop())
        setIsRecording(false)
        return
      }

      // Attach the listener at construction, before start(), so the first (and
      // only, without a timeslice) `dataavailable` is never missed.
      recorder.addEventListener('dataavailable', (event: BlobEvent) => {
        // Fire and forget: the worker sends no reply to a chunk write.
        worker.postMessage({
          type: 'recorder:write',
          payload: { chunk: event.data },
        })
      })
      mediaRecorderRef.current = recorder
      recorder.start()
      takeRef.current = { filename, startedAt: new Date().toISOString() }

      // The stop arrived while the microphone was still opening, so it had no
      // recorder to act on. Honour it now. Without this the microphone stays
      // open and the file the worker created is never written.
      if (stopRequestedRef.current) {
        // That stop has already returned, so no claim is made for this take.
        takeRef.current = null
        void stopRecorder(recorder)
      }
    } finally {
      isStartingRef.current = false
      stopRequestedRef.current = false
    }
  }, [appContext, audioFormat, audioInputDeviceId, stopRecorder])

  /**
   * Flushes the file in the worker first, then stops the recorder. The final
   * chunk is written after that, on the last `dataavailable`. Then the worker
   * hashes the finished file and signs a claim over it.
   */
  const stopRecording = useCallback(async () => {
    if (appContext.type !== 'web-client') {
      return undefined
    }
    const endedAt = new Date().toISOString()
    const take = takeRef.current
    takeRef.current = null
    setIsRecording(false)
    try {
      await callWorker(appContext.worker, 'recorder:stop')
    } catch (error) {
      console.error('Failed to stop the recording file:', error)
    }

    const recorder = mediaRecorderRef.current
    if (!recorder) {
      if (isStartingRef.current) {
        // The microphone is still opening. `startRecording` stops the recorder
        // as soon as it has one.
        stopRequestedRef.current = true
        return undefined
      }
      console.error('mediaRecorderRef.current is null')
      return undefined
    }
    await stopRecorder(recorder)
    if (!take) {
      return undefined
    }

    // Signing is best effort. Without a key, as over plain HTTP where there is
    // no WebCrypto, the recording is kept and uploaded unsigned.
    try {
      const { claim } = await callWorker<{ claim: string }>(
        appContext.worker,
        'recorder:claim',
        {
          filename: take.filename,
          mimeType: recordingMimeType(audioFormat),
          startedAt: take.startedAt,
          endedAt,
        },
      )
      return claim
    } catch (error) {
      console.warn('Recording saved without a signed claim:', error)
      return undefined
    }
  }, [appContext, audioFormat, stopRecorder])

  const value = useMemo(
    () => ({
      isRecording,
      time,
      handleFilename,
      setIsRecording,
      startRecording,
      stopRecording,
    }),
    [isRecording, time, handleFilename, startRecording, stopRecording],
  )

  return <RecordingContext value={value}>{children}</RecordingContext>
}

// Function with retries to attempt finding supported mimetype
// https://stackoverflow.com/a/78132616
const mimeTypes = ['audio/mp4']

const getMediaRecorder = async (
  stream: MediaStream,
  mimeIndex = 0,
): Promise<MediaRecorder> => {
  try {
    const mimeType = mimeTypes[mimeIndex]
    MediaRecorder.isTypeSupported(mimeType)
    return new MediaRecorder(stream, { mimeType })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotSupportedError') {
      console.error(`Mime type "${mimeTypes[mimeIndex]}" is not supported`)
    }
    if (mimeIndex < mimeTypes.length) {
      return getMediaRecorder(stream, mimeIndex + 1)
    }
    throw new Error('No supported mime type for MediaRecorder')
  }
}

export function useRecorder() {
  const context = use(RecordingContext)
  if (context === null) {
    throw new Error('useRecorder must be used within a RecordingProvider')
  }
  return context
}
