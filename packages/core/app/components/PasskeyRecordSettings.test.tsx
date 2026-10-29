import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { storePasskeyRecord } from '@/passkeyRecordClient'
import { runPasskeyCeremony } from '@/personKeyCeremony'
import { PasskeyRecordSettings } from './PasskeyRecordSettings'

vi.mock('@/personKeyCeremony', () => ({ runPasskeyCeremony: vi.fn() }))
vi.mock('@/passkeyRecordClient', () => ({ storePasskeyRecord: vi.fn() }))

const worker = {} as Worker
const ENDPOINT = { baseUrl: 'https://192.168.1.20:433', token: 'pair-token' }

const CEREMONY = {
  ok: true as const,
  credentialId: 'credential-id',
  rpId: 'tapes.network',
  prf: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
}

beforeEach(() => {
  vi.mocked(runPasskeyCeremony).mockResolvedValue(CEREMONY)
  vi.mocked(storePasskeyRecord).mockResolvedValue({
    ok: true,
    passkeyRecordedAt: '2026-10-29T09:00:00.000Z',
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderSettings(recordedAt?: string) {
  const onRecorded = vi.fn()
  render(
    <PasskeyRecordSettings
      worker={worker}
      endpoint={ENDPOINT}
      hostName="Studio Mac"
      personPublicKey="sam-key"
      recordedAt={recordedAt}
      onRecorded={onRecorded}
    />,
  )
  return { onRecorded }
}

describe('PasskeyRecordSettings', () => {
  it('makes a passkey for the person and leaves the record on the host', async () => {
    const user = userEvent.setup()
    const { onRecorded } = renderSettings()

    await user.click(screen.getByText('Protect with a passkey'))

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith('2026-10-29T09:00:00.000Z'),
    )
    // One passkey per person, not one per device.
    expect(runPasskeyCeremony).toHaveBeenCalledWith(
      { action: 'create', hostName: 'Studio Mac', userId: 'sam-key' },
      {},
    )
    expect(storePasskeyRecord).toHaveBeenCalledWith(worker, ENDPOINT, CEREMONY)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'bring this key back on a new phone',
    )
  })

  it('says a record is already there, and offers another passkey', () => {
    renderSettings('2026-10-29T09:00:00.000Z')

    expect(screen.getByText(/Studio Mac holds a copy/)).toBeTruthy()
    expect(screen.getByText('Use another passkey')).toBeTruthy()
  })

  it('names the password managers that return no PRF output', async () => {
    vi.mocked(runPasskeyCeremony).mockResolvedValue({
      ok: false,
      problem: 'no-prf',
    })
    const user = userEvent.setup()
    const { onRecorded } = renderSettings()

    await user.click(screen.getByText('Protect with a passkey'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'passphrase backup is the way through',
    )
    expect(onRecorded).not.toHaveBeenCalled()
    expect(storePasskeyRecord).not.toHaveBeenCalled()
  })

  it('explains a host that has not met this person', async () => {
    vi.mocked(storePasskeyRecord).mockResolvedValue({
      ok: false,
      problem: 'refused',
      detail: 'unknown-person',
    })
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByText('Protect with a passkey'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Studio Mac does not have you on its roster yet',
    )
  })
})
