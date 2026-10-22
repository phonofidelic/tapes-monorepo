import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppContextProvider } from '@/context/AppContext'
import { HostConnectionProvider } from '@/context/HostConnectionContext'
import type { HostConnection } from '@/hostConnection'
import {
  backUpPersonKey,
  checkPersonKeyBackup,
  createPersonKey,
  generatePassphrase,
  readPersonKeyStatus,
  type PersonKeyStatus,
} from '@/personKey'
import {
  BackupFlow,
  PersonKeyBackupPrompt,
  saveBackupFile,
} from './PersonKeyBackupPrompt'

vi.mock('@/personKey', () => ({
  readPersonKeyStatus: vi.fn(),
  createPersonKey: vi.fn(),
  generatePassphrase: vi.fn(),
  backUpPersonKey: vi.fn(),
  checkPersonKeyBackup: vi.fn(),
}))

const PASSPHRASE = 'abacus ablaze able abroad absence absolute'
const worker = {} as Worker

const STATUS: PersonKeyStatus = {
  exists: true,
  publicKey: 'person-key',
  certificate: 'encoded-certificate',
  certificateAddress: 'cd'.repeat(32),
}

beforeEach(() => {
  vi.mocked(generatePassphrase).mockResolvedValue(PASSPHRASE)
  vi.mocked(backUpPersonKey).mockResolvedValue({
    text: 'TPK1.backup',
    fileText: '{"format":"tapes-person-key-backup"}\n',
  })
  vi.mocked(checkPersonKeyBackup).mockResolvedValue({
    ok: true,
    backedUpAt: '2026-10-22T10:00:00.000Z',
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('BackupFlow', () => {
  const renderFlow = () => {
    const onBackedUp = vi.fn()
    const onLater = vi.fn()
    render(
      <BackupFlow worker={worker} onLater={onLater} onBackedUp={onBackedUp} />,
    )
    return { onBackedUp, onLater }
  }

  it('locks with the generated passphrase, saves, and checks it', async () => {
    const user = userEvent.setup()
    const { onBackedUp } = renderFlow()

    expect(await screen.findByText(PASSPHRASE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lock backup' }))
    expect(backUpPersonKey).toHaveBeenCalledWith(worker, PASSPHRASE)

    await user.click(
      await screen.findByRole('button', { name: 'Show QR code' }),
    )
    expect(screen.getByTitle('Person key backup')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'I saved it' }))

    await user.type(screen.getByRole('textbox'), PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Check' }))

    expect(checkPersonKeyBackup).toHaveBeenCalledWith(
      worker,
      'TPK1.backup',
      PASSPHRASE,
    )
    await waitFor(() =>
      expect(onBackedUp).toHaveBeenCalledWith('2026-10-22T10:00:00.000Z'),
    )
  })

  it('says so when the passphrase does not unlock the backup', async () => {
    const user = userEvent.setup()
    vi.mocked(checkPersonKeyBackup).mockResolvedValue({
      ok: false,
      problem: 'wrong-passphrase',
    })
    const { onBackedUp } = renderFlow()

    await screen.findByText(PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Lock backup' }))
    await user.click(await screen.findByRole('button', { name: 'I saved it' }))
    await user.type(screen.getByRole('textbox'), 'wrong words')
    await user.click(screen.getByRole('button', { name: 'Check' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That passphrase does not unlock the backup.',
    )
    expect(onBackedUp).not.toHaveBeenCalled()
  })

  it('needs a chosen passphrase of some length', async () => {
    const user = userEvent.setup()
    renderFlow()

    await screen.findByText(PASSPHRASE)
    await user.click(screen.getByRole('button', { name: 'Choose my own' }))
    const lock = screen.getByRole('button', { name: 'Lock backup' })
    await user.type(screen.getByRole('textbox'), 'short one')
    expect(lock).toBeDisabled()

    await user.type(screen.getByRole('textbox'), ' made longer')
    expect(lock).toBeEnabled()
    await user.click(lock)
    expect(backUpPersonKey).toHaveBeenCalledWith(
      worker,
      'short one made longer',
    )
  })

  it('lets the person put it off', async () => {
    const user = userEvent.setup()
    const { onLater } = renderFlow()

    await user.click(screen.getByRole('button', { name: 'Not now' }))

    expect(onLater).toHaveBeenCalled()
  })
})

describe('saveBackupFile', () => {
  it('offers the file to the share sheet where it can', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { canShare: () => true, share })

    await saveBackupFile('backup text')

    const [{ files }] = share.mock.calls[0] as [{ files: File[] }]
    expect(files[0].name).toBe('tapes-person-key-backup.txt')
    expect(await files[0].text()).toBe('backup text')
  })

  it('downloads the file without a share sheet', async () => {
    vi.stubGlobal('navigator', {})
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    URL.createObjectURL = vi.fn(() => 'blob:backup')
    URL.revokeObjectURL = vi.fn()

    await saveBackupFile('backup text')

    expect(click).toHaveBeenCalled()
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'tapes-person-key-backup.txt',
    )
  })
})

describe('PersonKeyBackupPrompt', () => {
  const connected: HostConnection = {
    isConnected: () => true,
    subscribe: () => () => {},
  }

  const renderPrompt = () =>
    render(
      <AppContextProvider value={{ type: 'web-client', worker }}>
        <HostConnectionProvider connection={connected}>
          <PersonKeyBackupPrompt />
        </HostConnectionProvider>
      </AppContextProvider>,
    )

  it('makes the person key on first join and asks for a backup', async () => {
    vi.mocked(readPersonKeyStatus).mockResolvedValue({ exists: false })
    vi.mocked(createPersonKey).mockResolvedValue(STATUS)

    renderPrompt()

    expect(
      await screen.findByRole('dialog', { name: 'Back up your person key' }),
    ).toBeInTheDocument()
    expect(createPersonKey).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'web-client' }),
      expect.any(String),
    )
  })

  it('stays away once a backup has been checked', async () => {
    vi.mocked(readPersonKeyStatus).mockResolvedValue({
      ...STATUS,
      backedUpAt: '2026-10-21T10:00:00.000Z',
    })

    renderPrompt()

    await waitFor(() => expect(readPersonKeyStatus).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(createPersonKey).not.toHaveBeenCalled()
  })
})
