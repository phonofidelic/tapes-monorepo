import { createContext, useCallback, useContext, useRef, useState } from 'react'

export type Settings = {
  audioInputDeviceId: string | undefined
  audioFormat: 'mp3' | 'wav' | 'ogg' | 'flac' | undefined
  audioChannelCount: '1' | '2' | undefined
  storageLocation: string | undefined
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
 * The shells read this blob straight out of storage to decide which sync
 * server to build their repo against. The electron renderer's repo builder
 * and the web client's sync-url resolver both do this. Its shape is therefore
 * a contract: one flat object of string values, with unset keys absent rather
 * than present and null.
 */
const STORAGE_KEY = 'settings'

const DEFAULT_SETTINGS: Partial<Settings> = {
  audioChannelCount: '1',
  audioFormat: 'wav',
}

/**
 * Publishes each settings write to the shells. Settings live in a context
 * inside the app, but the shells that build the Automerge repo sit above it.
 * Some settings, such as which sync server to use and whether the embedded
 * one speaks HTTPS, decide what that repo connects to. Publishing the changed
 * key lets a shell rebuild its repo live instead of reloading the window.
 * Module-level rather than context, because the listener is above the
 * provider.
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
  setSetting: <K extends SettingKey>(key: K, value: Settings[K]) => void
} | null>(null)

export const SettingsProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [settings, setSettings] = useState<Partial<Settings>>(readSettings)

  /**
   * React state is the source of truth, and the whole object is persisted on
   * every write, so storage never holds a key that state has dropped. The ref
   * makes two writes in the same tick compose. `settings` is a render-scoped
   * snapshot, and the second write would otherwise spread the value the first
   * one had already replaced.
   */
  const latestSettings = useRef(settings)

  const setSetting = useCallback(
    <K extends SettingKey>(key: K, value: Settings[K]) => {
      const updatedSettings = { ...latestSettings.current }
      if (value === undefined) {
        // `undefined` is the single representation of unset: dropping the key
        // keeps the in-memory object identical to what a reload parses back,
        // since `JSON.stringify` omits undefined values anyway.
        delete updatedSettings[key]
      } else {
        updatedSettings[key] = value
      }

      latestSettings.current = updatedSettings
      setSettings(updatedSettings)
      writeSettings(updatedSettings)
      notifySettingChange(key)
    },
    [],
  )

  return (
    <SettingsContext.Provider
      value={{
        settings,
        setSetting,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSetting<K extends SettingKey>(setting: K) {
  const context = useContext(SettingsContext)
  if (context === null) {
    throw new Error('useSetting must be used within a SettingsProvider')
  }
  const { settings, setSetting } = context

  const setValue = useCallback(
    (value: Settings[K]) => {
      setSetting(setting, value)
    },
    [setSetting, setting],
  )

  return [settings[setting], setValue] as const
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

function readSettings(): Partial<Settings> {
  try {
    const storedSettings = JSON.parse(
      globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}',
    ) as unknown

    if (
      typeof storedSettings !== 'object' ||
      storedSettings === null ||
      Array.isArray(storedSettings)
    ) {
      throw new Error('Stored settings are not an object')
    }

    // A merge, not an early return. A missing default must not cost the user
    // the keys that are stored, such as a storage location or the pairing a
    // guest device syncs through.
    return { ...DEFAULT_SETTINGS, ...(storedSettings as Partial<Settings>) }
  } catch (error) {
    // Corrupt JSON, or no storage at all, as in SSR or a locked-down browser.
    // Losing settings is recoverable. Throwing here takes down the whole app
    // from inside a `useState` initializer, which is not.
    console.warn('Could not read settings, falling back to defaults', error)
    return { ...DEFAULT_SETTINGS }
  }
}

function writeSettings(settings: Partial<Settings>) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.warn('Could not persist settings', error)
  }
}
