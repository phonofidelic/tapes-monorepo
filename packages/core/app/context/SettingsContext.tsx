import { createContext, useContext, useState } from 'react'

type Setting =
  | 'audioInputDeviceId'
  | 'audioFormat'
  | 'storageLocation'
  | 'settingsDocUrl'

const SettingsContext = createContext<{
  // setting: string
  // setSetting: (setting: string, value: string) => void
  audioInputDeviceId: string | null
  setAudioInputDeviceId: (deviceId: string) => void
  storageLocation: string | null
  setStorageLocation: (location: string) => void
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
  >(() => readSettingFromLocalStorage('audioInputDeviceId'))

  const [storageLocation, setStorageLocationState] = useState<string | null>(
    () => readSettingFromLocalStorage('storageLocation'),
  )

  const [settingsDocUrl, setSettingsDocUrlState] = useState<string | null>(() =>
    readSettingFromLocalStorage('settingsDocUrl'),
  )

  const setAudioInputDeviceId = (deviceId: string) => {
    setAudioInputDeviceIdState(deviceId)
    writeSettingToLocalStorage('audioInputDeviceId', deviceId)
  }

  const setStorageLocation = (location: string) => {
    writeSettingToLocalStorage('storageLocation', location)
  }

  const setSettingsDocUrl = (url: string) => {
    setSettingsDocUrlState(url)
    writeSettingToLocalStorage('settingsDocUrl', url)
  }

  return (
    <SettingsContext.Provider
      value={{
        audioInputDeviceId,
        setAudioInputDeviceId,
        storageLocation,
        setStorageLocation,
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

export function useSetting(setting: Setting) {
  const [value, setValueState] = useState<string | null>(() =>
    readSettingFromLocalStorage(setting),
  )

  const setValue = (value: string | null) => {
    setValueState(value)
    writeSettingToLocalStorage(setting, value)
  }
  return [value, setValue] as const
}

function writeSettingToLocalStorage(key: Setting, value: string | null) {
  if (value === null) {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...JSON.parse(localStorage.getItem('settings') || '{}'),
        [key]: undefined,
      }),
    )
    return
  }

  localStorage.setItem(
    'settings',
    JSON.stringify({
      ...JSON.parse(localStorage.getItem('settings') || '{}'),
      [key]: value,
    }),
  )
}

function readSettingFromLocalStorage(key: Setting) {
  return JSON.parse(localStorage.getItem('settings') || '{}')[key]
}
