import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AutomergeUrl } from '@automerge/automerge-repo'
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
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [clickedTime, setClickedTime] = useState(0)

  useEffect(() => {
    if (!currentSource) {
      return
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
  }, [currentSource])

  useEffect(() => {
    const audio = audioRef.current
    audio.load()

    const onLoadedMetadata = () => {
      setDuration(
        audio.duration / (appContext.type === 'electron-client' ? 1000 : 1),
      )
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
      audio.currentTime = duration
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
