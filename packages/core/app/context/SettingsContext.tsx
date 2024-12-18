import { createContext, useContext, useState } from 'react'

type Settings = {
  audioInputDeviceId: string | null
  audioFormat: string | null
  storageLocation: string | null
  settingsDocUrl: string | null
}

const SettingsContext = createContext<{
  settings: Settings
  setSettings: (settings: Settings) => void
} | null>(null)

export const SettingsProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [settings, setSettings] = useState<Settings>(
    readSettingsFromLocalStorage,
  )

  return (
    <SettingsContext.Provider
      value={{
        settings,
        setSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSetting(setting: keyof Settings) {
  const context = useContext(SettingsContext)
  if (context === null) {
    throw new Error('useSetting must be used within a SettingsProvider')
  }
  const { settings, setSettings } = context

  const setValue = (value: string | null) => {
    const updatedSetting = { ...settings, [setting]: value }
    setSettings(updatedSetting)
    writeSettingToLocalStorage(setting, value)
  }

  return [settings[setting], setValue] as const
}

function writeSettingToLocalStorage(key: keyof Settings, value: string | null) {
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

function readSettingsFromLocalStorage() {
  return JSON.parse(localStorage.getItem('settings') || '{}')
}
