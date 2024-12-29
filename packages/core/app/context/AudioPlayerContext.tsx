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
    if (!currentSource || appContext.type !== 'electron-client') {
      return
    }

    const audio = audioRef.current

    audio.src = `tapes://${currentSource}`
    console.log(audio.currentSrc)
    audio.load()
    isPlaying
      ? audio
          .play()
          .then(() => console.log('playing'))
          .catch((error) => console.error('Play error:', error))
      : audio.pause()

    const onLoadedMetadata = () => {
      console.log('*** loadedmetadata')
      setDuration(audio.duration)
    }

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const onEnded = () => {
      console.log('*** ended')
      audio.currentTime = duration / 1000
    }

    const onError = () => {
      console.error('Audio error:', audio.error?.message)
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [currentSource, isPlaying, duration])

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
