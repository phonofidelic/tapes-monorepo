import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { keyFingerprint } from '@tapes-monorepo/provenance'
import { AppContextProvider, type AppContextValue } from '@/context/AppContext'
import type { IpcService } from '@/IpcService'
import { refreshTrustedHosts } from '@/trustedHosts'
import { TrustedHostSettings } from './TrustedHostSettings'

// A real Ed25519 public key, so its fingerprint is the one the row shows.
const HOST_KEY = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'
const OTHER_KEY = 'K1Hb2mTBVFjCx9f8rjq1NmBCv6h7w8AWnmYeRxOgCx0'

let send: ReturnType<typeof vi.fn>

/** The list the host answers with, replaced as the operator changes it. */
let hosts: { hostKey: string; hostLabel?: string; addedAt: string }[]

beforeEach(() => {
  hosts = []
  refreshTrustedHosts()
  send = vi.fn((channel: string, request?: { data?: unknown }) => {
    if (channel === 'trust:get-hosts') {
      return Promise.resolve({ success: true, data: { hosts } })
    }
    const { hostKey, hostLabel } = (request?.data ?? {}) as {
      hostKey?: string
      hostLabel?: string
    }
    if (channel === 'trust:add-host') {
      if (hostKey !== HOST_KEY && hostKey !== OTHER_KEY) {
        return Promise.resolve({
          success: false,
          error: new Error('That is not a host key'),
        })
      }
      hosts = [...hosts, { hostKey, hostLabel, addedAt: 'now' }]
      return Promise.resolve({ success: true })
    }
    hosts = hosts.filter((host) => host.hostKey !== hostKey)
    return Promise.resolve({ success: true })
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const electronContext = (): AppContextValue => ({
  type: 'electron-client',
  ipc: { send } as unknown as IpcService,
})

const webContext: AppContextValue = {
  type: 'web-client',
  worker: {} as unknown as Worker,
}

// Resolved before any render, so waiting for a row's fingerprint is one await
// and the row's own update is settled inside it.
const HOST_FINGERPRINT = (await keyFingerprint(HOST_KEY))!
const OTHER_FINGERPRINT = (await keyFingerprint(OTHER_KEY))!

const renderSettings = (context: AppContextValue = electronContext()) =>
  render(
    <AppContextProvider value={context}>
      <TrustedHostSettings />
    </AppContextProvider>,
  )

describe('TrustedHostSettings', () => {
  it('says so when no other host is trusted', async () => {
    renderSettings()

    expect(
      await screen.findByText('No other host is trusted.'),
    ).toBeInTheDocument()
  })

  // Only a host's operator keeps a list, so a guest is offered nothing.
  it('shows nothing on a client with no host of its own', () => {
    renderSettings(webContext)

    expect(screen.queryByText('Trusted hosts')).not.toBeInTheDocument()
  })

  it('shows a trusted key by its fingerprint and the name from its vouches', async () => {
    hosts = [{ hostKey: HOST_KEY, hostLabel: 'Studio Mac', addedAt: 'now' }]
    renderSettings()

    expect(await screen.findByText(HOST_FINGERPRINT)).toBeInTheDocument()
    expect(screen.getByText('“Studio Mac”')).toBeInTheDocument()
  })

  // A key read off a pairing link carries no name for the host.
  it('shows a key with no name by its fingerprint alone', async () => {
    hosts = [{ hostKey: HOST_KEY, addedAt: 'now' }]
    renderSettings()

    expect(await screen.findByText(HOST_FINGERPRINT)).toBeInTheDocument()
    expect(screen.getByText('Host')).toBeInTheDocument()
  })

  it('trusts a key the operator types in', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByText('No other host is trusted.')

    await user.type(
      await screen.findByLabelText('Trust another host by its key'),
      HOST_KEY,
    )
    await user.click(screen.getByRole('button', { name: 'Trust host' }))

    expect(send).toHaveBeenCalledWith('trust:add-host', {
      data: { hostKey: HOST_KEY },
    })
    expect(await screen.findByText(HOST_FINGERPRINT)).toBeInTheDocument()
  })

  it('trims a key pasted with surrounding space', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByText('No other host is trusted.')

    await user.type(
      await screen.findByLabelText('Trust another host by its key'),
      `  ${HOST_KEY}  `,
    )
    await user.click(screen.getByRole('button', { name: 'Trust host' }))

    expect(send).toHaveBeenCalledWith('trust:add-host', {
      data: { hostKey: HOST_KEY },
    })
    expect(await screen.findByText(HOST_FINGERPRINT)).toBeInTheDocument()
  })

  it('reports text that is not a host key', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByText('No other host is trusted.')

    await user.type(
      await screen.findByLabelText('Trust another host by its key'),
      'not-a-key',
    )
    await user.click(screen.getByRole('button', { name: 'Trust host' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That is not a host key.',
    )
  })

  it('offers nothing to submit until a key is typed', async () => {
    renderSettings()
    await screen.findByText('No other host is trusted.')

    expect(screen.getByRole('button', { name: 'Trust host' })).toBeDisabled()
  })

  it('removes a key the operator no longer trusts', async () => {
    const user = userEvent.setup()
    hosts = [
      { hostKey: HOST_KEY, hostLabel: 'Studio Mac', addedAt: 'now' },
      { hostKey: OTHER_KEY, hostLabel: 'Loft Mac', addedAt: 'now' },
    ]
    renderSettings()
    await screen.findByText(HOST_FINGERPRINT)
    await screen.findByText(OTHER_FINGERPRINT)

    const row = screen.getByText('“Studio Mac”').closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Stop trusting' }))

    expect(send).toHaveBeenCalledWith('trust:remove-host', {
      data: { hostKey: HOST_KEY },
    })
    expect(screen.queryByText('“Studio Mac”')).not.toBeInTheDocument()
    expect(screen.getByText('“Loft Mac”')).toBeInTheDocument()
  })
})
