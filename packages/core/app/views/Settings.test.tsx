import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { generateAutomergeUrl } from '@automerge/automerge-repo'
import { AppContextProvider, type AppContextValue } from '@/context/AppContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { Settings } from './Settings'

// The selector enumerates real devices through `navigator.mediaDevices`, which
// jsdom has no notion of; none of it is what these tests are about.
vi.mock('@/components/AudioInputSelector', () => ({
  AudioInputSelector: () => <div data-testid="audio-input-selector" />,
}))

const HOST_DOC_URL = generateAutomergeUrl()

const webContext: AppContextValue = {
  type: 'web-client',
  worker: {} as unknown as Worker,
}

const renderSettings = () =>
  render(
    <AppContextProvider value={webContext}>
      <SettingsProvider>
        <Settings />
      </SettingsProvider>
    </AppContextProvider>,
  )

const importHostUrl = async (url: string) => {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Paste the host URL here'), url)
  await user.click(screen.getByTitle('Import data'))
}

const readSettings = () =>
  JSON.parse(localStorage.getItem('settings') ?? '{}') as Record<
    string,
    unknown
  >

describe('Settings: importing a host url', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(cleanup)

  it('stores the imported document and confirms it on screen', async () => {
    renderSettings()

    await importHostUrl(`http://192.168.1.5:9001/?am=${HOST_DOC_URL}`)

    expect(localStorage.getItem('automergeUrl')).toBe(HOST_DOC_URL)
    expect(await screen.findByRole('status')).toHaveTextContent(/Imported/)
  })

  // Without the token this device can reach the imported document's id but
  // neither the host's sync socket nor its `/blobs`.
  it('keeps the pairing token the link carries', async () => {
    renderSettings()

    await importHostUrl(
      `http://192.168.1.5:9001/?am=${HOST_DOC_URL}&pt=host-token`,
    )

    expect(readSettings().pairingToken).toBe('host-token')
  })

  it('leaves the stored document alone when the url carries no document', async () => {
    renderSettings()

    await importHostUrl('http://192.168.1.5:9001/')

    expect(localStorage.getItem('automergeUrl')).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
