import { createContext, useContext, useState } from 'react'

const SettingsContext = createContext<{
  audioInputDeviceId: string | null
  setAudioInputDeviceId: (deviceId: string) => void
  settingsDocUrl: string | null
  setSettingsDocUrl: (url: string) => void
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
      ? JSON.parse(localStorage.getItem('settings') ?? '{}').audioInputDeviceId
      : null
  })
  const [settingsDocUrl, setSettingsDocUrlState] = useState<string | null>(
    () => {
      return localStorage.getItem('settings')
        ? JSON.parse(localStorage.getItem('settings') ?? '{}').settingsDocUrl
        : null
    },
  )

  const setAudioInputDeviceId = (deviceId: string) => {
    setAudioInputDeviceIdState(deviceId)
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...JSON.parse(localStorage.getItem('settings') ?? '{}'),
        audioInputDeviceId: deviceId,
      }),
    )
  }

  const setSettingsDocUrl = (url: string) => {
    setSettingsDocUrlState(url)
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...JSON.parse(localStorage.getItem('settings') || '{}'),
        settingsDocUrl: url,
      }),
    )
  }

  return (
    <SettingsContext.Provider
      value={{
        audioInputDeviceId,
        setAudioInputDeviceId,
        settingsDocUrl,
        setSettingsDocUrl,
      }}
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
