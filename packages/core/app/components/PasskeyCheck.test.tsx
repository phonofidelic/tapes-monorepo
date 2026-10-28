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

    await userEvent.click(
      screen.getByRole('button', { name: 'Make a passkey' }),
    )

    expect(runPasskeyCeremony).toHaveBeenCalledWith(
      { action: 'create', hostName: 'Studio Mac', userId: 'person-key' },
      {},
    )
    // The output itself is never shown, only a short hash of it, so two phones
    // can be compared.
    expect(
      await screen.findByText(
        /A passkey answered for tapes.network. Credential credenti…, PRF ([0-9a-f]{4}-){2}[0-9a-f]{4}./,
      ),
    ).toBeInTheDocument()
  })

  it('can also use a passkey that already exists', async () => {
    vi.mocked(runPasskeyCeremony).mockResolvedValue({
      ok: true,
      credentialId: 'credential-id-value',
      rpId: 'tapes.network',
      prf: new Uint8Array(32),
    })
    render(<PasskeyCheck hostName="Studio Mac" />)

    await userEvent.click(screen.getByRole('button', { name: 'Use a passkey' }))

    expect(runPasskeyCeremony).toHaveBeenCalledWith(
      { action: 'get', hostName: 'Studio Mac', userId: undefined },
      {},
    )
  })

  it('explains a password manager that returns no PRF output', async () => {
    vi.mocked(runPasskeyCeremony).mockResolvedValue({
      ok: false,
      problem: 'no-prf',
    })
    render(<PasskeyCheck hostName="Studio Mac" />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Make a passkey' }),
    )

    expect(await screen.findByText(/returns no PRF output/)).toBeInTheDocument()
  })

  it('keeps going when the ceremony throws', async () => {
    vi.mocked(runPasskeyCeremony).mockRejectedValue(new Error('no'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<PasskeyCheck hostName="Studio Mac" />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Make a passkey' }),
    )

    expect(await screen.findByText(/could not finish/)).toBeInTheDocument()
  })
})
