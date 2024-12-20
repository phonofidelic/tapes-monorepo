import { createContext, useContext, useState } from 'react'

type Settings = {
  audioInputDeviceId: string | undefined
  audioFormat: 'mp3' | 'wav' | 'ogg' | 'flac' | undefined
  audioChannelCount: '1' | '2' | undefined
  storageLocation: string | undefined
  settingsDocUrl: string | undefined
}

const SettingsContext = createContext<{
  settings: Partial<Settings>
  setSettings: (settings: Partial<Settings>) => void
} | null>(null)

export const SettingsProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [settings, setSettings] = useState<Partial<Settings>>(
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

function readSettingsFromLocalStorage(): Partial<Settings> {
  const storedSettings = JSON.parse(
    localStorage.getItem('settings') ?? '{}',
  ) as Partial<Settings>

  if (
    !storedSettings ||
    !storedSettings.audioChannelCount ||
    !storedSettings.audioFormat
  ) {
    !storedSettings.audioChannelCount &&
      writeSettingToLocalStorage('audioChannelCount', '1')
    !storedSettings.audioFormat &&
      writeSettingToLocalStorage('audioFormat', 'wav')
    return {
      audioChannelCount: storedSettings.audioChannelCount ?? '1',
      audioFormat: storedSettings.audioFormat ?? 'wav',
    }
  }

  return storedSettings
}
