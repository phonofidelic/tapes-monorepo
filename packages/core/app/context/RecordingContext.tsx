import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAppContext } from './AppContext'
import { getAudioStream } from '@/utils'
import { useSetting } from './SettingsContext'
import { callWorker } from '@/workerClient'

const RecordingContext = createContext<{
  isRecording: boolean
  time: number
  handleFilename: string | null
  setIsRecording: (state: boolean) => void
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
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

    const recorder = await getMediaRecorder(audioStream)
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
  }, [appContext, audioFormat, audioInputDeviceId])

  /**
   * Flushes the file in the worker first, then stops the recorder. The final
   * chunk is written after that, on the last `dataavailable`.
   */
  const stopRecording = useCallback(async () => {
    if (appContext.type !== 'web-client') {
      return
    }
    setIsRecording(false)
    try {
      await callWorker(appContext.worker, 'recorder:stop')
    } catch (error) {
      console.error('Failed to stop the recording file:', error)
    }

    const recorder = mediaRecorderRef.current
    if (!recorder) {
      console.error('mediaRecorderRef.current is null')
      return
    }
    // stop() fires a final `dataavailable` asynchronously, so the listener
    // must stay attached; release the mic tracks once the recorder has
    // actually stopped.
    recorder.addEventListener(
      'stop',
      () => {
        recorder.stream.getTracks().forEach((track) => track.stop())
      },
      { once: true },
    )
    recorder.stop()
    mediaRecorderRef.current = null
  }, [appContext])

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

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  )
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
  const context = useContext(RecordingContext)
  if (context === null) {
    throw new Error('useRecorder must be used within a RecordingProvider')
  }
  return context
}
