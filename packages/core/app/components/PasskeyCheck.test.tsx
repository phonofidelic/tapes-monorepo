import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { runPasskeyCeremony } from '@/personKeyCeremony'
import { PasskeyCheck, passkeyCheckEnabled } from './PasskeyCheck'

vi.mock('@/personKeyCeremony', () => ({ runPasskeyCeremony: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('passkeyCheckEnabled', () => {
  it('is on only for passkey=1', () => {
    expect(passkeyCheckEnabled('?passkey=1')).toBe(true)
    expect(passkeyCheckEnabled('?am=doc&passkey=1')).toBe(true)
    expect(passkeyCheckEnabled('?passkey=yes')).toBe(false)
    expect(passkeyCheckEnabled('')).toBe(false)
  })
})

describe('PasskeyCheck', () => {
  it('sends the host name and the person key, and reports what came back', async () => {
    vi.mocked(runPasskeyCeremony).mockResolvedValue({
      ok: true,
      credentialId: 'credential-id-value',
      rpId: 'tapes.network',
      prf: new Uint8Array(32),
    })
    render(<PasskeyCheck hostName="Studio Mac" personPublicKey="person-key" />)

    await userEvent.click(screen.getByRole('button'))

    expect(runPasskeyCeremony).toHaveBeenCalledWith(
      { action: 'create', hostName: 'Studio Mac', userId: 'person-key' },
      {},
    )
    expect(
      await screen.findByText(/A passkey answered for tapes.network/),
    ).toBeInTheDocument()
    // The output itself is never shown, only its length.
    expect(screen.getByText(/32 bytes of PRF output/)).toBeInTheDocument()
  })

  it('explains a password manager that returns no PRF output', async () => {
    vi.mocked(runPasskeyCeremony).mockResolvedValue({
      ok: false,
      problem: 'no-prf',
    })
    render(<PasskeyCheck hostName="Studio Mac" />)

    await userEvent.click(screen.getByRole('button'))

    expect(await screen.findByText(/returns no PRF output/)).toBeInTheDocument()
  })

  it('keeps going when the ceremony throws', async () => {
    vi.mocked(runPasskeyCeremony).mockRejectedValue(new Error('no'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<PasskeyCheck hostName="Studio Mac" />)

    await userEvent.click(screen.getByRole('button'))

    expect(await screen.findByText(/could not finish/)).toBeInTheDocument()
  })
})
