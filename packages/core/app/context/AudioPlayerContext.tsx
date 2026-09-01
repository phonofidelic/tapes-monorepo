import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { RecordingData } from '@/types'
import { fetchBlob } from '@/blobClient'
import { cacheBlob, cachedBlobSource, recordCacheHit } from '@/blobCache'
import { useAppContext } from './AppContext'
import { useBlobEndpoint } from './BlobContext'

/**
 * `loading` covers fetching a recording's audio from the host on first play,
 * which can take a moment for a long tape; `error` means it could not be
 * resolved at all, which previously just cleared the player with no
 * explanation.
 */
export type PlaybackState = 'idle' | 'loading' | 'ready' | 'error'

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
  playbackState: PlaybackState
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
  const blobEndpoint = useBlobEndpoint()
  const audioRef = useRef<HTMLAudioElement>(new Audio())
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle')
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
    // Detach whatever the player is holding before resolving anything.
    // Resolving is asynchronous and can fail outright, and until this ran the
    // element kept the previous recording's `src`: play an unavailable tape
    // and the last one played instead, under the new recording's name.
    const audio = audioRef.current
    audio.pause()
    audio.removeAttribute('src')
    audio.load()

    if (!currentUrl) {
      return
    }

    // Wait for the recording doc to resolve before choosing a source. Until it
    // loads we can't tell where the audio is, and falling back to storage:get
    // here throws NotFoundError for a recording synced from another device
    // (whose bytes were never in this device's OPFS).
    if (!recordingDoc) {
      return
    }

    let cancelled = false
    let objectUrl: string | undefined

    const play = (src: string, revoke = false) => {
      if (cancelled) {
        if (revoke) {
          URL.revokeObjectURL(src)
        }
        return
      }
      if (revoke) {
        objectUrl = src
      }
      if (audioRef.current) {
        audioRef.current.src = src
      }
      setPlaybackState('ready')
    }

    const resolve = async () => {
      setPlaybackState('loading')
      // The transport belongs to whatever is being loaded now, not to the
      // recording that was just detached.
      setCurrentTime(0)
      setDuration(0)
      durationRef.current = 0

      // 1. Legacy embedded bytes. Automerge history is append-only, so docs
      //    written before audio moved out of band still carry their audio and
      //    always will. They have no hash, so this never competes with the
      //    paths below.
      const embeddedAudio = recordingDoc.audio
      if (embeddedAudio) {
        play(
          URL.createObjectURL(
            // Automerge types the bytes as Uint8Array<ArrayBufferLike>, but
            // BlobPart wants Uint8Array<ArrayBuffer>; identical at runtime.
            new Blob([embeddedAudio as BlobPart], {
              type: recordingDoc.mimeType ?? 'audio/mp4',
            }),
          ),
          true,
        )
        return
      }

      const descriptor = recordingDoc.blob

      // 2. Already cached locally, from an earlier play or an explicit pin.
      //    This is the path that works with the host switched off.
      if (descriptor) {
        const cached = await cachedBlobSource(appContext, descriptor)
        if (cached) {
          play(cached.src, cached.revoke)
          return
        }
      }

      // 3. This device's own copy of a recording it made itself. Also covers
      //    a recording whose upload has not landed yet.
      const local = await localSource()
      if (local) {
        play(local.src, local.revoke)
        return
      }

      // 4. Fetch from the host and keep what comes back, so a guest's storage
      //    grows with what it has played rather than with the whole library.
      if (descriptor && blobEndpoint) {
        try {
          const blob = await fetchBlob(blobEndpoint, descriptor.hash)
          if (cancelled) {
            return
          }
          play(URL.createObjectURL(blob), true)
          await cacheBlob(appContext, descriptor, blob, recordingDoc.url)
          recordCacheHit(descriptor.hash, descriptor.size, localStorage)
          return
        } catch (error) {
          console.error('Could not fetch recording audio:', error)
        }
      }

      if (!cancelled) {
        setPlaybackState('error')
        // There is nothing loaded to play, so leaving the transport running
        // would show a pause button over silence.
        setIsPlaying(false)
      }
    }

    /**
     * The bytes as this device stored them at record time: an OPFS file on
     * web, the user's own audio file on electron.
     */
    const localSource = async (): Promise<{
      src: string
      revoke: boolean
    } | null> => {
      if (!currentSource) {
        return null
      }
      if (appContext.type === 'electron-client') {
        // The protocol handler resolves a path this device knows about; a
        // recording made elsewhere has a filepath that means nothing here.
        return recordingDoc.filepath
          ? { src: `tapes://${currentSource}`, revoke: false }
          : null
      }
      return new Promise((resolveSource) => {
        const worker = appContext.worker
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== 'storage:get:response') {
            return
          }
          worker.removeEventListener('message', onMessage)
          if (!event.data.success) {
            resolveSource(null)
            return
          }
          const { url } = event.data.payload as { url: string }
          resolveSource({ src: url, revoke: false })
        }
        worker.addEventListener('message', onMessage)
        worker.postMessage({
          type: 'storage:get',
          payload: { filename: currentSource },
        })
      })
    }

    void resolve()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [
    currentUrl,
    currentSource,
    appContext,
    blobEndpoint,
    recordingDoc,
    recordingDoc?.audio,
    recordingDoc?.blob,
  ])

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
        playbackState,
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
