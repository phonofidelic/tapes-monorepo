import { createContext, useContext, useState } from 'react'

const RecordingContext = createContext<{
  isRecording: boolean
  setIsRecording: (state: boolean) => void
} | null>(null)

export const RecordingProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [isRecording, setIsRecording] = useState(false)
  return (
    <RecordingContext.Provider
      value={{
        isRecording,
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
