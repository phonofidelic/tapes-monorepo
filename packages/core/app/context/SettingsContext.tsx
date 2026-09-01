import { createContext, useContext, useState } from 'react'

type Settings = {
  audioInputDeviceId: string | undefined
  audioFormat: 'mp3' | 'wav' | 'ogg' | 'flac' | undefined
  audioChannelCount: '1' | '2' | undefined
  storageLocation: string | undefined
  automergeUrl: string | undefined
  syncServerMode: 'embedded' | 'remote' | undefined
  remoteSyncServerUrl: string | undefined
  /**
   * Token for a host this device is a guest of: captured from the pairing URL
   * on web, typed in on the desktop app when it points at another Tapes host.
   * It opens that host's sync socket and its `/blobs` surface alike.
   */
  pairingToken: string | undefined
  syncServerLanEnabled: 'true' | 'false' | undefined
  syncServerHttpsEnabled: 'true' | 'false' | undefined
}

export type SettingKey = keyof Settings

/**
 * Settings live in a React context inside `App`, but the shells that build the
 * Automerge `Repo` sit above it — and some of these settings (which sync server
 * to use, whether the embedded one speaks HTTPS) decide what that repo is
 * connected to. This is the seam between the two: every write publishes the key
 * that changed, so a shell can re-resolve and rebuild its repo live instead of
 * reloading the window. Module-level rather than context, because the listener
 * is above the provider.
 */
const settingsListeners = new Set<(key: SettingKey) => void>()

export function subscribeToSettingsChange(
  listener: (key: SettingKey) => void,
): () => void {
  settingsListeners.add(listener)
  return () => {
    settingsListeners.delete(listener)
  }
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

function writeSettingToLocalStorage(key: SettingKey, value: string | null) {
  localStorage.setItem(
    'settings',
    JSON.stringify({
      ...JSON.parse(localStorage.getItem('settings') || '{}'),
      [key]: value === null ? undefined : value,
    }),
  )
  notifySettingChange(key)
}

function notifySettingChange(key: SettingKey) {
  for (const listener of settingsListeners) {
    try {
      listener(key)
    } catch (error) {
      // One listener throwing must not stop the others, or leave the write
      // half-published.
      console.error('Settings change listener failed', error)
    }
  }
}

function readSettingsFromLocalStorage(): Partial<Settings> {
  const storedSettings = JSON.parse(
    localStorage.getItem('settings') ?? '{}',
  ) as Partial<Settings>

  if (!storedSettings?.audioChannelCount || !storedSettings?.audioFormat) {
    if (!storedSettings?.audioChannelCount) {
      writeSettingToLocalStorage('audioChannelCount', '1')
    }
    if (!storedSettings?.audioFormat) {
      writeSettingToLocalStorage('audioFormat', 'wav')
    }
    return {
      audioChannelCount: storedSettings?.audioChannelCount ?? '1',
      audioFormat: storedSettings?.audioFormat ?? 'wav',
    }
  }

  return storedSettings
}
