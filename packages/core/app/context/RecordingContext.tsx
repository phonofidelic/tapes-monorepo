import { createContext, useContext, useEffect, useState } from 'react'

const RecordingContext = createContext<{
  isRecording: boolean
  time: number
  setIsRecording: (state: boolean) => void
} | null>(null)

export const RecordingStateProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [isRecording, setIsRecording] = useState(false)
  const [time, setTime] = useState(0)

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

  return (
    <RecordingContext.Provider
      value={{
        isRecording,
        time,
        setIsRecording,
      }}
    >
      {children}
    </RecordingContext.Provider>
  )
}

export function useRecordingState() {
  const context = useContext(RecordingContext)
  if (context === null) {
    throw new Error('useRecordingState must be used within a RecordingProvider')
  }
  return context
}
