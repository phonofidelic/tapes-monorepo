import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  exportPublicKey,
  generateSigningKeyPair,
  keyFingerprint,
} from '@tapes-monorepo/provenance'
import { AppContextProvider, type AppContextValue } from '@/context/AppContext'
import type { IpcService } from '@/IpcService'
import { trustHost } from '@/trustedHosts'
import { TrustedHostsSettings } from './TrustedHostsSettings'

const electronContext: AppContextValue = {
  type: 'electron-client',
  ipc: { send: vi.fn() } as unknown as IpcService,
}

const webContext: AppContextValue = {
  type: 'web-client',
  worker: {} as unknown as Worker,
}

const renderSettings = (appContext: AppContextValue = electronContext) =>
  render(
    <AppContextProvider value={appContext}>
      <TrustedHostsSettings />
    </AppContextProvider>,
  )

describe('TrustedHostsSettings', () => {
  let hostKey: string
  // Resolved up front: awaiting it after the render would let the row's own
  // fingerprint land outside `act`.
  let fingerprint: string | undefined

  afterEach(() => {
    cleanup()
  })

  beforeEach(async () => {
    localStorage.clear()
    hostKey = await exportPublicKey((await generateSigningKeyPair()).publicKey)
    fingerprint = await keyFingerprint(hostKey)
  })

  it('says where to trust a host when none is trusted yet', () => {
    renderSettings()

    expect(
      screen.getByText(/No other host is trusted/, { exact: false }),
    ).toBeInTheDocument()
  })

  it('names each trusted host by label and key fingerprint', async () => {
    trustHost({ hostKey, hostLabel: 'Studio Mac' })

    renderSettings()

    expect(await screen.findByText(`key ${fingerprint}`)).toBeInTheDocument()
    expect(screen.getByText('“Studio Mac”')).toBeInTheDocument()
  })

  it('stops trusting a host when the operator says so', async () => {
    trustHost({ hostKey, hostLabel: 'Studio Mac' })

    renderSettings()
    await screen.findByText(`key ${fingerprint}`)
    await userEvent.click(screen.getByText('Stop trusting this host'))

    await waitFor(() =>
      expect(screen.queryByText('“Studio Mac”')).not.toBeInTheDocument(),
    )
    expect(localStorage.getItem('tapes.trustedHosts')).toBe('{}')
  })

  // Which hosts count is a decision about the recordings a host holds, so a
  // guest is not asked to make it.
  it('shows nothing on a guest', () => {
    trustHost({ hostKey, hostLabel: 'Studio Mac' })

    renderSettings(webContext)

    expect(screen.queryByText('Trusted hosts')).not.toBeInTheDocument()
  })
})
