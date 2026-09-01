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
      return <button onClick={() => setPairingToken(null)}>clear</button>
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
