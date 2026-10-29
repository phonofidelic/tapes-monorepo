import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  backupToFileText,
  backupToText,
  generateSigningKeyPair,
  wrapPersonKey,
} from '@tapes-monorepo/provenance'
import type { BlobEndpoint } from '@/blobClient'
import { fetchPasskeyRecord } from '@/passkeyRecordClient'
import {
  restorePersonKey,
  restorePersonKeyWithPasskey,
  type PersonKeyStatus,
} from '@/personKey'
import { runPasskeyCeremony } from '@/personKeyCeremony'
import { decodeQrFromImage } from '@/qrDecode'
import { RestoreFlow } from './RestoreFlow'

vi.mock('@/personKey', () => ({
  restorePersonKey: vi.fn(),
  restorePersonKeyWithPasskey: vi.fn(),
}))
vi.mock('@/personKeyCeremony', () => ({ runPasskeyCeremony: vi.fn() }))
vi.mock('@/passkeyRecordClient', () => ({ fetchPasskeyRecord: vi.fn() }))
vi.mock('@/qrDecode', () => ({
  decodeQr: vi.fn(),
  decodeQrFromImage: vi.fn(),
  frameData: vi.fn(),
}))

const worker = {} as Worker

// A real backup, locked with a fast stand-in for Argon2id. The screen only
// parses it. Unlocking is the worker's job, which these tests stub.
const backup = await wrapPersonKey(
  await generateSigningKeyPair(true),
  'abacus ablaze able',
  async () => new Uint8Array(32),
)
const BACKUP_TEXT = backupToText(backup)

const RESTORED: PersonKeyStatus = {
  exists: true,
  publicKey: 'sam-key',
  certificate: 'encoded-certificate',
  certificateAddress: 'cd'.repeat(32),
  backedUpAt: '2026-10-24T12:00:00.000Z',
}

beforeEach(() => {
  vi.mocked(restorePersonKey).mockResolvedValue({ ok: true, status: RESTORED })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ENDPOINT: BlobEndpoint = {
  baseUrl: 'https://host.example',
  token: 'pair-token',
}

/** The record the host holds, and the passkey that opens it. */
const RECORD = 'a-stored-record'
const CEREMONY = {
  ok: true as const,
  credentialId: 'credential-id',
  rpId: 'tapes.network',
  prf: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
}

function renderFlow(endpoint?: BlobEndpoint) {
  const onRestored = vi.fn()
  render(
    <RestoreFlow
      worker={worker}
      endpoint={endpoint}
      hostName="Studio Mac"
      onRestored={onRestored}
      onCancel={vi.fn()}
    />,
  )
  return { onRestored }
}

async function unlock(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByLabelText('Your passphrase'),
    'abacus ablaze able',
  )
  await user.click(screen.getByRole('button', { name: 'Restore' }))
}

describe('RestoreFlow', () => {
  it('restores from pasted text and the passphrase', async () => {
    const user = userEvent.setup()
    const { onRestored } = renderFlow()

    await user.type(
      screen.getByLabelText('Or paste the backup text'),
      BACKUP_TEXT,
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await unlock(user)

    expect(restorePersonKey).toHaveBeenCalledWith(
      worker,
      BACKUP_TEXT,
      'abacus ablaze able',
      expect.any(String),
    )
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(RESTORED))
  })

  it('reads the saved backup file', async () => {
    const user = userEvent.setup()
    renderFlow()

    await user.upload(
      screen.getByLabelText(/Choose the backup file/),
      new File([backupToFileText(backup)], 'tapes-person-key-backup.txt', {
        type: 'text/plain',
      }),
    )

    expect(await screen.findByText('Found your backup.')).toBeInTheDocument()
  })

  it('reads the QR code in a photo', async () => {
    vi.mocked(decodeQrFromImage).mockResolvedValue(BACKUP_TEXT)
    const user = userEvent.setup()
    renderFlow()

    await user.upload(
      screen.getByLabelText(/Choose the backup file/),
      new File(['jpeg bytes'], 'backup.jpg', { type: 'image/jpeg' }),
    )

    expect(await screen.findByText('Found your backup.')).toBeInTheDocument()
  })

  it('says so when a photo has no readable QR code', async () => {
    vi.mocked(decodeQrFromImage).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderFlow()

    await user.upload(
      screen.getByLabelText(/Choose the backup file/),
      new File(['jpeg bytes'], 'blurry.jpg', { type: 'image/jpeg' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No QR code could be read in that photo.',
    )
  })

  it('refuses text that is not a backup before asking for a passphrase', async () => {
    const user = userEvent.setup()
    renderFlow()

    await user.type(screen.getByLabelText('Or paste the backup text'), 'hello')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'That is not a Tapes person key backup.',
    )
    expect(screen.queryByLabelText('Your passphrase')).not.toBeInTheDocument()
  })

  it('says so when the passphrase is wrong', async () => {
    vi.mocked(restorePersonKey).mockResolvedValue({
      ok: false,
      problem: 'wrong-passphrase',
    })
    const user = userEvent.setup()
    const { onRestored } = renderFlow()

    await user.type(
      screen.getByLabelText('Or paste the backup text'),
      BACKUP_TEXT,
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await unlock(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That passphrase does not unlock the backup.',
    )
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('falls back to a photo or the file when there is no camera', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      },
    })
    const user = userEvent.setup()
    renderFlow()

    await user.click(
      screen.getByRole('button', { name: 'Scan the QR code with the camera' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The camera could not be opened.',
    )
    expect(
      screen.getByLabelText('Or paste the backup text'),
    ).toBeInTheDocument()
  })
})

describe('restoring with a passkey', () => {
  beforeEach(() => {
    vi.mocked(runPasskeyCeremony).mockResolvedValue(CEREMONY)
    vi.mocked(fetchPasskeyRecord).mockResolvedValue({
      ok: true,
      record: RECORD,
    })
    vi.mocked(restorePersonKeyWithPasskey).mockResolvedValue({
      ok: true,
      status: RESTORED,
    })
  })

  it('is offered only where the host can be reached', () => {
    renderFlow()
    expect(screen.queryByText('Use your passkey')).toBeNull()

    cleanup()
    renderFlow(ENDPOINT)
    expect(screen.getByText('Use your passkey')).toBeTruthy()
  })

  it('opens the copy the host holds', async () => {
    const user = userEvent.setup()
    const { onRestored } = renderFlow(ENDPOINT)

    await user.click(screen.getByText('Use your passkey'))

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(RESTORED))
    expect(runPasskeyCeremony).toHaveBeenCalledWith(
      { action: 'get', hostName: 'Studio Mac' },
      {},
    )
    expect(fetchPasskeyRecord).toHaveBeenCalledWith(ENDPOINT, CEREMONY)
    expect(vi.mocked(restorePersonKeyWithPasskey).mock.calls[0][1]).toBe(RECORD)
  })

  it('sends a person back to their backup when the host holds no copy', async () => {
    vi.mocked(fetchPasskeyRecord).mockResolvedValue({
      ok: false,
      problem: 'no-record',
    })
    const user = userEvent.setup()
    const { onRestored } = renderFlow(ENDPOINT)

    await user.click(screen.getByText('Use your passkey'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Studio Mac holds no copy for that passkey',
    )
    expect(onRestored).not.toHaveBeenCalled()
    // Back on the first step, with the backup still an option.
    expect(screen.getByText('Scan the QR code with the camera')).toBeTruthy()
  })

  it('says when the password manager returns no PRF output', async () => {
    vi.mocked(runPasskeyCeremony).mockResolvedValue({
      ok: false,
      problem: 'no-prf',
    })
    const user = userEvent.setup()
    renderFlow(ENDPOINT)

    await user.click(screen.getByText('Use your passkey'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'passphrase backup is the way through',
    )
  })

  it('says when the passkey does not open the record', async () => {
    vi.mocked(restorePersonKeyWithPasskey).mockResolvedValue({
      ok: false,
      problem: 'wrong-passkey',
    })
    const user = userEvent.setup()
    renderFlow(ENDPOINT)

    await user.click(screen.getByText('Use your passkey'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'does not open the copy your host holds',
    )
  })
})
