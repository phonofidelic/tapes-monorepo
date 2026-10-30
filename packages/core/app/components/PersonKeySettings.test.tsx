import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterPerson } from '@tapes-monorepo/sync-protocol'
import { AppContextProvider } from '@/context/AppContext'
import { BlobProvider } from '@/context/BlobContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { readPersonKeyStatus, type PersonKeyStatus } from '@/personKey'
import { fetchRoster, readVouchState } from '@/rosterClient'
import { PersonKeySettings } from './PersonKeySettings'

vi.mock('@/personKey', () => ({ readPersonKeyStatus: vi.fn() }))

vi.mock('@/rosterClient', () => ({
  changePin: vi.fn(),
  fetchRoster: vi.fn(),
  joinHostRoster: vi.fn(),
  readVouchState: vi.fn(),
}))

// The flow that asks the host has its own tests. Here it only has to finish,
// either with a vouch or with what went wrong.
vi.mock('./RejoinFlow', () => ({
  RejoinFlow: ({
    title,
    onVouched,
    onBack,
  }: {
    title: string
    onVouched: (status: PersonKeyStatus) => void
    onBack: (error?: string) => void
  }) => (
    <div role="dialog" aria-label={title}>
      <button
        onClick={() =>
          onVouched({
            exists: true,
            publicKey: 'sam-key',
            certificate: 'second-vouch',
            certificateAddress: 'cd'.repeat(32),
            vouchedBy: 'Studio Mac',
          })
        }
      >
        Finish vouching
      </button>
      <button onClick={() => onBack('The host said no.')}>Give up</button>
    </div>
  ),
}))

const ENDPOINT = { baseUrl: 'https://192.168.1.20:433', token: 'pair-token' }

const SAM: RosterPerson = {
  personKey: 'sam-key',
  name: 'Sam',
  hasPin: true,
  pinLocked: false,
}

const HOLDS_KEY: PersonKeyStatus = {
  exists: true,
  publicKey: 'sam-key',
  certificate: 'encoded-certificate',
  certificateAddress: 'ab'.repeat(32),
  backedUpAt: '2026-10-24T12:00:00.000Z',
  joinedAt: '2026-10-24T11:00:00.000Z',
}

const VOUCHED: PersonKeyStatus = {
  exists: true,
  publicKey: 'sam-key',
  certificate: 'encoded-vouch',
  certificateAddress: 'ab'.repeat(32),
  vouchedBy: 'Studio Mac',
  joinedAt: '2026-10-24T11:00:00.000Z',
}

const ASK_AGAIN = 'Ask Studio Mac to vouch again'

beforeEach(() => {
  vi.mocked(fetchRoster).mockResolvedValue([SAM])
  vi.mocked(readVouchState).mockResolvedValue({ state: 'standing' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderSettings = (status: PersonKeyStatus) => {
  vi.mocked(readPersonKeyStatus).mockResolvedValue(status)
  render(
    <AppContextProvider value={{ type: 'web-client', worker: {} as Worker }}>
      <SettingsProvider>
        <BlobProvider endpoints={[ENDPOINT]}>
          <PersonKeySettings />
        </BlobProvider>
      </SettingsProvider>
    </AppContextProvider>,
  )
}

describe('PersonKeySettings: asking for another vouch', () => {
  it('asks the host as the person on its roster, and keeps the old vouch standing', async () => {
    const user = userEvent.setup()
    renderSettings(VOUCHED)

    await user.click(await screen.findByRole('button', { name: ASK_AGAIN }))
    const flow = screen.getByRole('dialog', { name: ASK_AGAIN })
    await user.click(
      within(flow).getByRole('button', { name: 'Finish vouching' }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'This device has a new vouch. The old one still stands for the takes it signed.',
    )
  })

  it('shows what the host answered when it did not vouch', async () => {
    const user = userEvent.setup()
    renderSettings(VOUCHED)

    await user.click(await screen.findByRole('button', { name: ASK_AGAIN }))
    await user.click(screen.getByRole('button', { name: 'Give up' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The host said no.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // Its own certificate is what a vouch would stand in for. Restoring the
  // person key is the way back for that device, not a second vouch.
  it('offers nothing to a device that holds the person key', async () => {
    renderSettings(HOLDS_KEY)

    expect(
      await screen.findByText(
        'This device has your person key, and it is backed up.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /vouch again/ }),
    ).not.toBeInTheDocument()
  })

  it('says the host withdrew the vouch, and makes the ask the next step', async () => {
    vi.mocked(readVouchState).mockResolvedValue({
      state: 'withdrawn',
      revokedAt: '2026-10-28T09:00:00.000Z',
      revocation: 'ef'.repeat(32),
    })
    renderSettings(VOUCHED)

    expect(
      await screen.findByText(
        'This device has no person key. Studio Mac withdrew its vouch for it.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/judged by when the host received them/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ASK_AGAIN })).toBeInTheDocument()
    expect(readVouchState).toHaveBeenCalledWith(ENDPOINT, 'ab'.repeat(32))
  })

  // A host whose roster was replaced knows no vouch at that address, which is
  // not the same as having withdrawn it.
  it('says nothing about a withdrawal the host does not report', async () => {
    vi.mocked(readVouchState).mockResolvedValue(undefined)
    renderSettings(VOUCHED)

    expect(
      await screen.findByText(
        'This device has no person key. Studio Mac vouched for it.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/judged by when the host received them/),
    ).not.toBeInTheDocument()
  })

  // The host refuses a request for a person it does not have, so there is
  // nothing to offer but a word with the operator.
  it('sends a device the host no longer lists to the operator', async () => {
    vi.mocked(fetchRoster).mockResolvedValue([])
    renderSettings(VOUCHED)

    expect(
      await screen.findByText(/no longer has you on its roster/),
    ).toHaveTextContent('Studio Mac no longer has you on its roster')
    expect(
      screen.queryByRole('button', { name: /vouch again/ }),
    ).not.toBeInTheDocument()
  })
})
