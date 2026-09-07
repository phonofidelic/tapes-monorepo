import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { generateAutomergeUrl } from '@automerge/automerge-repo'
import { AppContextProvider, type AppContextValue } from '@/context/AppContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { Settings } from './Settings'
import type { IpcService, SyncServerInfo } from '@/IpcService'
import { decodeFingerprint, encodeFingerprint } from '@/pairing'

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

const FINGERPRINT =
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

// The form `getSyncServerRootFingerprint` hands the renderer.
const HOST_FINGERPRINT =
  '9F:86:D0:81:88:4C:7D:65:9A:2F:EA:A0:C5:5A:D0:15:A3:BF:4F:1B:2B:0B:82:2C:D1:5D:6C:15:B0:F0:0A:08'

const serverInfo: SyncServerInfo = {
  running: true,
  url: 'wss://127.0.0.1:9001',
  lanWebAppUrl: 'https://192.168.1.5:9001',
  pairingToken: 'host-token',
  rootCertFingerprint: HOST_FINGERPRINT,
  port: 9001,
  host: '0.0.0.0',
}

const renderHostSettings = (info: SyncServerInfo) => {
  const ipc = {
    send: vi.fn().mockResolvedValue(info),
  } as unknown as IpcService

  return render(
    <AppContextProvider value={{ type: 'electron-client', ipc }}>
      <SettingsProvider>
        <Settings />
      </SettingsProvider>
    </AppContextProvider>,
  )
}

// The fingerprint is what a guest checks the downloaded root against. Nothing
// verifies it for them, so it has to be legible on both ends.
describe('Settings: the host root fingerprint', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('automergeUrl', HOST_DOC_URL)
    localStorage.setItem(
      'settings',
      JSON.stringify({
        syncServerMode: 'embedded',
        syncServerLanEnabled: 'true',
      }),
    )
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows it in colon-separated pairs, so it can be read aloud', async () => {
    renderHostSettings(serverInfo)

    expect(await screen.findByText(HOST_FINGERPRINT)).toBeInTheDocument()
  })

  // The QR encodes the same string the copy button hands over, so copying is
  // how a test reads what a phone would scan.
  it('carries it in the pairing link, alongside the document and the token', async () => {
    const writeText = vi.fn()
    const user = userEvent.setup({ writeToClipboard: false })
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })
    renderHostSettings(serverInfo)

    await user.click(await screen.findByTitle('Copy URL to clipboard'))

    const link = new URL(writeText.mock.calls[0][0] as string)
    expect(link.searchParams.get('am')).toBe(HOST_DOC_URL)
    expect(link.searchParams.get('pt')).toBe('host-token')
    expect(decodeFingerprint(link.searchParams.get('fp')!)).toBe(FINGERPRINT)
  })

  it('shows nothing when the server is not running over TLS', async () => {
    renderHostSettings({ ...serverInfo, rootCertFingerprint: undefined })

    await screen.findByTitle('Copy URL to clipboard')

    expect(screen.queryByText(/^[0-9A-F]{2}:/)).not.toBeInTheDocument()
  })
})

// A guest that scanned the host's code arrives with the fingerprint in its
// URL. Handing it on to the trust page is what lets that page check the root
// it offers, instead of asking the person to walk back to the host.
describe('Settings: the guest link to the trust page', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('automergeUrl', HOST_DOC_URL)
  })

  afterEach(() => {
    cleanup()
    window.history.replaceState({}, '', '/')
  })

  it('forwards the fingerprint the app was opened with', async () => {
    const fp = encodeFingerprint(HOST_FINGERPRINT)
    window.history.replaceState({}, '', `/?am=${HOST_DOC_URL}&fp=${fp}`)
    renderSettings()

    const link = await screen.findByRole('link', {
      name: /Install this host.s certificate/,
    })

    expect(link).toHaveAttribute('href', `/trust?fp=${fp}`)
  })

  // Without one there is nothing for the page to check, and the host it would
  // point at is one with no certificate to install.
  it('offers no link when the app was opened without a fingerprint', () => {
    window.history.replaceState({}, '', `/?am=${HOST_DOC_URL}`)
    renderSettings()

    expect(
      screen.queryByRole('link', { name: /Install this host.s certificate/ }),
    ).not.toBeInTheDocument()
  })
})
