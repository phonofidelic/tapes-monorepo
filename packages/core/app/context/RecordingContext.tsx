import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAppContext } from './AppContext'
import { getAudioStream } from '@/utils'
import { useSetting } from './SettingsContext'

const RecordingContext = createContext<{
  isRecording: boolean
  time: number
  handleFilename: string | null
  setIsRecording: (state: boolean) => void
} | null>(null)

export const RecordingStateProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const appContext = useAppContext()
  const [audioInputDeviceId] = useSetting('audioInputDeviceId')
  const [isRecording, setIsRecording] = useState(false)
  const [time, setTime] = useState(0)
  const [handleFilename, setHandleFilename] = useState<string | null>(null)
  // The active recorder must survive this effect re-running (e.g. on a device
  // change) between the start and stop messages, so it lives in a ref rather
  // than an effect-local variable.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  // Opening the microphone is asynchronous and can take seconds, so a stop can
  // arrive before there is any recorder to stop. These two carry that stop
  // across the gap. See the start and stop handlers below.
  const isStartingRef = useRef(false)
  const stopRequestedRef = useRef(false)

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

  useEffect(() => {
    if (appContext.type !== 'web-client') {
      return
    }

    // Function with retries to attempt finding supported mimetype
    // https://stackoverflow.com/a/78132616
    const mimeTypes = ['audio/mp4']
    const getMediaRecorder = async (stream: MediaStream, mimeIndex = 0) => {
      try {
        const mimeType = mimeTypes[mimeIndex]
        MediaRecorder.isTypeSupported(mimeType)
        return new MediaRecorder(stream, { mimeType })
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === 'NotSupportedError'
        ) {
          console.error(`Mime type "${mimeTypes[mimeIndex]}" is not supported`)
        }
        if (mimeIndex < mimeTypes.length) {
          return getMediaRecorder(stream, mimeIndex + 1)
        }
        throw new Error('No supported mime type for MediaRecorder')
      }
    }

    const { worker } = appContext

    const onDataAvailable = (event: BlobEvent) => {
      worker.postMessage({
        type: 'recorder:write',
        payload: { chunk: event.data },
      })
    }

    const stopRecorder = (recorder: MediaRecorder) => {
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
    }

    const onMessage = async (event: MessageEvent) => {
      const { type, payload } = event.data
      switch (type) {
        case 'recorder:start:response': {
          setHandleFilename(payload.filename)
          isStartingRef.current = true
          stopRequestedRef.current = false
          let audioStream: MediaStream | null = null
          try {
            audioStream = await getAudioStream(audioInputDeviceId ?? '')
            const recorder = await getMediaRecorder(audioStream)
            // Attach the listener at construction, before start(), so the first
            // (and only, without a timeslice) `dataavailable` is never missed.
            recorder.addEventListener('dataavailable', onDataAvailable)
            mediaRecorderRef.current = recorder
            recorder.start()
            // The stop arrived while the microphone was still opening, so the
            // stop handler had no recorder to act on. Honour it now: the take
            // is over, and without this the mic stays open and the file the
            // worker opened is never written.
            if (stopRequestedRef.current) {
              stopRecorder(recorder)
            }
          } catch (error) {
            // Otherwise this rejects inside an event listener and the UI stays
            // in the recording state with no recorder behind it.
            console.error('Failed to start recording:', error)
            audioStream?.getTracks().forEach((track) => track.stop())
            setIsRecording(false)
          } finally {
            isStartingRef.current = false
            stopRequestedRef.current = false
          }
          break
        }
        case 'recorder:start:error':
          // Without this the UI stays in the recording state with no recorder.
          console.error('Failed to start recording:', payload.error)
          setIsRecording(false)
          break
        case 'recorder:stop:response': {
          const recorder = mediaRecorderRef.current
          if (!recorder) {
            if (isStartingRef.current) {
              // The microphone is still opening. The start handler stops the
              // recorder as soon as it has one.
              stopRequestedRef.current = true
              break
            }
            console.error('mediaRecorderRef.current is null')
            break
          }
          stopRecorder(recorder)
          break
        }
        default:
          // Unhandled message
          break
      }
    }
    worker.addEventListener('message', onMessage)

    return () => {
      worker.removeEventListener('message', onMessage)
    }
  }, [appContext, audioInputDeviceId])

  const value = useMemo(
    () => ({
      isRecording,
      time,
      handleFilename,
      setIsRecording,
    }),
    [isRecording, time, handleFilename],
  )

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  )
}

export function useRecorder() {
  const context = useContext(RecordingContext)
  if (context === null) {
    throw new Error('useRecorder must be used within a RecordingProvider')
  }
  return context
}
