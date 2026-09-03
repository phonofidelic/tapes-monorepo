import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SettingsProvider,
  subscribeToSettingsChange,
  useSetting,
} from './SettingsContext'

// The shells build their Automerge repo above `App`, so a sync-settings change
// made in Settings can only reach them through this subscription — without it
// the only way to apply one is a full page reload (TAP-58).
function RemoteUrlEditor() {
  const [remoteSyncServerUrl, setRemoteSyncServerUrl] = useSetting(
    'remoteSyncServerUrl',
  )
  return (
    <button onClick={() => setRemoteSyncServerUrl('wss://sync.example.com')}>
      {remoteSyncServerUrl ?? 'unset'}
    </button>
  )
}

function storedSettings() {
  return JSON.parse(localStorage.getItem('settings') ?? '{}')
}

// One probe for the whole suite: renders the settings under test and exposes a
// button per write, so a reload is just a re-render of a fresh provider.
function SettingsProbe() {
  const [audioFormat] = useSetting('audioFormat')
  const [audioChannelCount] = useSetting('audioChannelCount')
  const [storageLocation, setStorageLocation] = useSetting('storageLocation')
  const [pairingToken] = useSetting('pairingToken')
  const [syncServerMode, setSyncServerMode] = useSetting('syncServerMode')

  return (
    <ul>
      <li data-testid="audioFormat">{audioFormat ?? 'unset'}</li>
      <li data-testid="audioChannelCount">{audioChannelCount ?? 'unset'}</li>
      <li data-testid="storageLocation">{storageLocation ?? 'unset'}</li>
      <li data-testid="pairingToken">{pairingToken ?? 'unset'}</li>
      <li data-testid="syncServerMode">{syncServerMode ?? 'unset'}</li>
      <button onClick={() => setStorageLocation(undefined)}>clear</button>
      <button
        onClick={() => {
          // Both in one tick: the second write must not spread the render
          // snapshot the first one already replaced.
          setStorageLocation('/tmp/tapes')
          setSyncServerMode('remote')
        }}
      >
        write both
      </button>
    </ul>
  )
}

describe('settings persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps every stored setting when a defaulted one is missing', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        storageLocation: '/Users/someone/Recordings',
        pairingToken: 'token-abc',
        audioChannelCount: '2',
      }),
    )

    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    )

    expect(screen.getByTestId('storageLocation')).toHaveTextContent(
      '/Users/someone/Recordings',
    )
    expect(screen.getByTestId('pairingToken')).toHaveTextContent('token-abc')
    expect(screen.getByTestId('audioChannelCount')).toHaveTextContent('2')
    // The missing one falls back to its default rather than short-circuiting
    // the read and taking the other keys with it.
    expect(screen.getByTestId('audioFormat')).toHaveTextContent('wav')
  })

  it('reads a cleared setting the same way before and after a reload', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ storageLocation: '/Users/someone/Recordings' }),
    )

    const { unmount } = render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'clear' }))

    expect(screen.getByTestId('storageLocation')).toHaveTextContent('unset')
    expect('storageLocation' in storedSettings()).toBe(false)

    unmount()
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    )

    expect(screen.getByTestId('storageLocation')).toHaveTextContent('unset')
  })

  it('loads on defaults when the stored settings are corrupt', () => {
    localStorage.setItem('settings', '{not json at all')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() =>
      render(
        <SettingsProvider>
          <SettingsProbe />
        </SettingsProvider>,
      ),
    ).not.toThrow()

    expect(screen.getByTestId('audioFormat')).toHaveTextContent('wav')
    expect(screen.getByTestId('audioChannelCount')).toHaveTextContent('1')
    expect(screen.getByTestId('storageLocation')).toHaveTextContent('unset')
  })

  it('loads on defaults when the stored settings are not an object', () => {
    localStorage.setItem('settings', '"just a string"')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    )

    expect(screen.getByTestId('audioFormat')).toHaveTextContent('wav')
  })

  it('keeps both writes when two settings change in the same tick', async () => {
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'write both' }))

    expect(screen.getByTestId('storageLocation')).toHaveTextContent(
      '/tmp/tapes',
    )
    expect(screen.getByTestId('syncServerMode')).toHaveTextContent('remote')
    expect(storedSettings()).toMatchObject({
      storageLocation: '/tmp/tapes',
      syncServerMode: 'remote',
    })
  })

  it('persists the settings the shells read straight out of storage', async () => {
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'write both' }))

    // rendererRepo.ts and syncServerUrl.ts parse this blob themselves, so it
    // has to stay one flat object of plain string values.
    const stored = storedSettings()
    expect(
      Object.values(stored).every((value) => typeof value === 'string'),
    ).toBe(true)
  })
})

describe('subscribeToSettingsChange', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('publishes the key a settings write changed', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToSettingsChange(listener)

    render(
      <SettingsProvider>
        <RemoteUrlEditor />
      </SettingsProvider>,
    )
    listener.mockClear()

    await userEvent.click(screen.getByRole('button'))

    expect(listener).toHaveBeenCalledWith('remoteSyncServerUrl')
    expect(
      JSON.parse(localStorage.getItem('settings') ?? '{}').remoteSyncServerUrl,
    ).toBe('wss://sync.example.com')
    unsubscribe()
  })

  it('stops publishing once unsubscribed', async () => {
    const listener = vi.fn()
    subscribeToSettingsChange(listener)()

    render(
      <SettingsProvider>
        <RemoteUrlEditor />
      </SettingsProvider>,
    )
    await userEvent.click(screen.getByRole('button'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('still notifies the remaining listeners when one throws', async () => {
    const thrower = vi.fn(() => {
      throw new Error('listener blew up')
    })
    const listener = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unsubscribeThrower = subscribeToSettingsChange(thrower)
    const unsubscribe = subscribeToSettingsChange(listener)

    render(
      <SettingsProvider>
        <RemoteUrlEditor />
      </SettingsProvider>,
    )
    listener.mockClear()

    await userEvent.click(screen.getByRole('button'))

    expect(thrower).toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith('remoteSyncServerUrl')
    unsubscribeThrower()
    unsubscribe()
  })

  // Clearing a setting is how the pairing token is removed, and that changes
  // where blobs can be fetched from just as much as setting one does.
  it('publishes a cleared setting too', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToSettingsChange(listener)

    function TokenClearer() {
      const [, setPairingToken] = useSetting('pairingToken')
      return <button onClick={() => setPairingToken(undefined)}>clear</button>
    }

    render(
      <SettingsProvider>
        <TokenClearer />
      </SettingsProvider>,
    )
    listener.mockClear()

    await userEvent.click(screen.getByRole('button'))

    expect(listener).toHaveBeenCalledWith('pairingToken')
    expect(
      'pairingToken' in JSON.parse(localStorage.getItem('settings') ?? '{}'),
    ).toBe(false)
    unsubscribe()
  })
})
