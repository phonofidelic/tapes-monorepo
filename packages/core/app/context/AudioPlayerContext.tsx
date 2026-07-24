import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { RecordingData } from '@/types'
import { useAppContext } from './AppContext'

type AudioPlayerContextValue = {
  audioRef: React.RefObject<HTMLAudioElement>
  currentTime: number
  duration: number
  currentSource: string | undefined
  setCurrentSource: React.Dispatch<React.SetStateAction<string | undefined>>
  currentUrl: AutomergeUrl | undefined
  setCurrentUrl: React.Dispatch<React.SetStateAction<AutomergeUrl | undefined>>
  isPlaying: boolean
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>
  clickedTime: number
  setClickedTime: React.Dispatch<React.SetStateAction<number>>
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | undefined>(
  undefined,
)

export const AudioPlayerProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const appContext = useAppContext()
  const audioRef = useRef<HTMLAudioElement>(new Audio())
  const [currentSource, setCurrentSource] = useState<string | undefined>(
    undefined,
  )
  const [currentUrl, setCurrentUrl] = useState<AutomergeUrl | undefined>(
    undefined,
  )
  // The recording doc for whatever is loaded in the player. When it carries
  // embedded `audio` bytes (synced from another device) we play those directly,
  // so a guest can play a recording it never made.
  const [recordingDoc] = useDocument<RecordingData>(currentUrl)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Mirrors `duration` so `onEnded` can read the latest value without the
  // audio effect re-running (and calling audio.load()) whenever it changes.
  const durationRef = useRef(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [clickedTime, setClickedTime] = useState(0)

  useEffect(() => {
    if (!currentSource) {
      return
    }

    // Wait for the recording doc to resolve before choosing a source. Until it
    // loads we can't tell whether it has embedded bytes, and falling back to
    // storage:get here throws NotFoundError for a recording synced from another
    // device (its bytes are in the doc, not this device's OPFS).
    if (!recordingDoc) {
      return
    }

    // Prefer bytes embedded in the synced doc. This path is platform-independent
    // and is the only one that works for a device that did not record the audio
    // (its OPFS is empty / it has no `tapes://` handler). The bytes may arrive
    // asynchronously as the doc syncs in, so this effect re-runs when they do.
    const embeddedAudio = recordingDoc.audio
    if (embeddedAudio) {
      const objectUrl = URL.createObjectURL(
        // Automerge types the bytes as Uint8Array<ArrayBufferLike>, but BlobPart
        // wants Uint8Array<ArrayBuffer>; they are identical at runtime.
        new Blob([embeddedAudio as BlobPart], {
          type: recordingDoc?.mimeType ?? 'audio/mp4',
        }),
      )
      if (audioRef.current) {
        audioRef.current.src = objectUrl
      }
      return () => {
        URL.revokeObjectURL(objectUrl)
      }
    }

    const onMessage = async (event: MessageEvent) => {
      if (!audioRef.current) {
        return
      }

      if (event.data.type === 'storage:get:response') {
        if (!event.data.success) {
          console.error('Play error:', event.data.error)
          setCurrentUrl(undefined)
          return
        }

        const { url } = event.data.payload as {
          url: string
        }

        audioRef.current.src = url
      }
    }

    if (appContext.type === 'web-client') {
      appContext.worker.addEventListener('message', onMessage)
      appContext.worker.postMessage({
        type: 'storage:get',
        payload: {
          filename: currentSource,
        },
      })
    } else {
      audioRef.current.src = `tapes://${currentSource}`
    }

    return () => {
      if (appContext.type === 'web-client') {
        appContext.worker.removeEventListener('message', onMessage)
      }
    }
  }, [currentSource, appContext, recordingDoc?.audio, recordingDoc?.mimeType])

  useEffect(() => {
    const audio = audioRef.current
    audio.load()

    const onLoadedMetadata = () => {
      durationRef.current = audio.duration
      setDuration(audio.duration)
    }

    const onCanPlay = async () => {
      if (isPlaying) {
        await audio.play()
      }
    }

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const onEnded = () => {
      audio.pause()
      setIsPlaying(false)
      setCurrentTime(0)
      audio.currentTime = durationRef.current
    }

    const onError = () => {
      console.error('Audio error:', audio.error)
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [isPlaying])

  return (
    <AudioPlayerContext.Provider
      value={{
        audioRef,
        currentTime,
        duration,
        currentSource,
        setCurrentSource,
        currentUrl,
        setCurrentUrl,
        isPlaying,
        setIsPlaying,
        clickedTime,
        setClickedTime,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  )
}

export const useAudioPlayer = (): AudioPlayerContextValue => {
  const context = useContext(AudioPlayerContext)

  if (context === undefined) {
    throw new Error('useAudioPlayer must be used within an AudioPlayerProvider')
  }
  return context
}
