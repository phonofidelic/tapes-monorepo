'use client'

import { createContext, useContext, useState } from 'react'

const SettingsContext = createContext<{
  audioInputDeviceId: string | null
  setAudioInputDeviceId: (deviceId: string) => void
} | null>(null)

export const SettingsProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [audioInputDeviceId, setAudioInputDeviceIdState] = useState<
    string | null
  >(() => {
    return localStorage.getItem('settings')
      ? JSON.parse(localStorage.getItem('settings') || '{}').audioInputDeviceId
      : null
  })

  const setAudioInputDeviceId = (deviceId: string) => {
    setAudioInputDeviceIdState(deviceId)
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...JSON.parse(localStorage.getItem('settings') || '{}'),
        audioInputDeviceId: deviceId,
      }),
    )
  }

  return (
    <SettingsContext.Provider
      value={{ audioInputDeviceId, setAudioInputDeviceId }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === null) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
