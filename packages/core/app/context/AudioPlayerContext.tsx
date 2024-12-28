import { createContext, useContext, useState } from 'react'
import { AutomergeUrl } from '@automerge/automerge-repo'

type AudioPlayerContextValue = {
  audio: HTMLAudioElement
  currentTime: number
  duration: number
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
  const audio = new Audio()
  const [currentUrl, setCurrentUrl] = useState<AutomergeUrl | undefined>(
    undefined,
  )
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [clickedTime, setClickedTime] = useState(0)

  return (
    <AudioPlayerContext.Provider
      value={{
        audio,
        currentTime,
        duration,
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
