import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useAppContext } from './AppContext'
import { getAudioStream } from '@/utils'
import { useSetting } from './SettingsContext'

const RecordingContext = createContext<{
  isRecording: boolean
  time: number
  mediaRecorder: MediaRecorder | null
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const handleFilenameRef = useRef<string | null>(null)

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
      } catch (error: any) {
        if (error.code === 9) {
          console.error(`Mime type "${mimeTypes[mimeIndex]}" is not supported`)
        }
        if (mimeIndex < mimeTypes.length) {
          return getMediaRecorder(stream, mimeIndex + 1)
        }
        throw new Error('No supported mime type for MediaRecorder')
      }
    }

    const { worker } = appContext
    const onMessage = async (event: MessageEvent) => {
      const { type, payload } = event.data
      switch (type) {
        case 'recorder:start:response':
          const { filename } = payload as {
            handle: FileSystemFileHandle
            filename: string
          }
          handleFilenameRef.current = filename
          const audioStream = await getAudioStream(audioInputDeviceId ?? '')
          mediaRecorderRef.current = await getMediaRecorder(audioStream)
          mediaRecorderRef.current.start()
          break
        case 'recorder:stop:response':
          if (!mediaRecorderRef.current) {
            console.error('mediaRecorderRef.current is null')
            return
          }
          mediaRecorderRef.current.stop()
          mediaRecorderRef.current = null
          break
        default:
          // Unhandled message
          break
      }
    }
    worker.addEventListener('message', onMessage)

    return () => {
      worker.removeEventListener('message', onMessage)
    }
  }, [])

  useEffect(() => {
    if (appContext.type !== 'web-client' || !mediaRecorderRef.current) {
      return
    }

    const mediaRecorder = mediaRecorderRef.current
    const { worker } = appContext

    const onDataAvailable = (event: BlobEvent) => {
      worker.postMessage({
        type: 'recorder:write',
        payload: { chunk: event.data },
      })
    }

    mediaRecorder.addEventListener('dataavailable', onDataAvailable)

    return () => {
      mediaRecorder.removeEventListener('dataavailable', onDataAvailable)
    }
  }, [mediaRecorderRef.current, handleFilenameRef.current])

  return (
    <RecordingContext.Provider
      value={{
        isRecording,
        time,
        handleFilename: handleFilenameRef.current,
        mediaRecorder: mediaRecorderRef.current,
        setIsRecording,
      }}
    >
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
