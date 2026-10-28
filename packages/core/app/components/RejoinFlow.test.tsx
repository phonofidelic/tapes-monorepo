import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterPerson } from '@tapes-monorepo/sync-protocol'
import { AppContextProvider } from '@/context/AppContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { markPersonKeyJoined, type PersonKeyStatus } from '@/personKey'
import {
  acceptVouch,
  askForVouch,
  readVouchStatus,
  tryPin,
} from '@/rosterClient'
import { VOUCH_POLL_MS, WelcomeBackFlow } from './RejoinFlow'

vi.mock('@/personKey', () => ({ markPersonKeyJoined: vi.fn() }))

// The restore screen has its own tests. Here it only has to finish.
vi.mock('./RestoreFlow', () => ({
  RestoreFlow: ({
    onRestored,
  }: {
    onRestored: (status: PersonKeyStatus) => void
  }) => (
    <button
      onClick={() =>
        onRestored({
          exists: true,
          publicKey: 'sam-key',
          certificate: 'encoded-certificate',
          certificateAddress: 'cd'.repeat(32),
          backedUpAt: '2026-10-24T12:00:00.000Z',
        })
      }
    >
      Finish restoring
    </button>
  ),
}))

vi.mock('@/localDeviceKey', () => ({
  readLocalDeviceKey: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('@/rosterClient', () => ({
  acceptVouch: vi.fn(),
  askForVouch: vi.fn(),
  readVouchStatus: vi.fn(),
  tryPin: vi.fn(),
}))

const worker = {} as Worker
const ENDPOINT = { baseUrl: 'https://192.168.1.20:433', token: 'pair-token' }
const HOST_KEY = 'pinned-host-key'

const SAM: RosterPerson = {
  personKey: 'sam-key',
  name: 'Sam',
  hasPin: true,
  pinLocked: false,
}
const ALEX: RosterPerson = {
  personKey: 'alex-key',
  name: 'Alex',
  hasPin: false,
  pinLocked: false,
}

const VOUCHED: PersonKeyStatus = {
  exists: true,
  publicKey: 'sam-key',
  certificate: 'encoded-vouch',
  certificateAddress: 'ab'.repeat(32),
  vouchedBy: 'Studio Mac',
}

beforeEach(() => {
  localStorage.setItem('settings', JSON.stringify({ pinnedHostKey: HOST_KEY }))
  vi.mocked(askForVouch).mockResolvedValue('request-1')
  vi.mocked(readVouchStatus).mockResolvedValue({ status: 'pending' })
  vi.mocked(acceptVouch).mockResolvedValue({ ok: true, status: VOUCHED })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

function renderFlow() {
  const onNew = vi.fn(() => Promise.resolve())
  const onIdentified = vi.fn()
  render(
    <AppContextProvider value={{ type: 'web-client', worker }}>
      <SettingsProvider>
        <WelcomeBackFlow
          worker={worker}
          endpoint={ENDPOINT}
          roster={[SAM, ALEX]}
          onNew={onNew}
          onIdentified={onIdentified}
          onLater={vi.fn()}
        />
      </SettingsProvider>
    </AppContextProvider>,
  )
  return { onNew, onIdentified }
}

describe('WelcomeBackFlow', () => {
  it('lists the people the host knows, and lets a new person say so', async () => {
    const user = userEvent.setup()
    const { onNew } = renderFlow()

    expect(screen.getByRole('button', { name: 'Sam' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alex' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: "I'm new here" }))

    expect(onNew).toHaveBeenCalled()
    expect(askForVouch).not.toHaveBeenCalled()
  })

  it('marks a restored person the host knows as joined', async () => {
    vi.mocked(markPersonKeyJoined).mockResolvedValue({
      joinedAt: '2026-10-24T12:00:01.000Z',
    })
    const user = userEvent.setup()
    const { onIdentified } = renderFlow()

    await user.click(
      screen.getByRole('button', { name: 'Restore from a backup' }),
    )
    await user.click(screen.getByRole('button', { name: 'Finish restoring' }))

    await waitFor(() =>
      expect(onIdentified).toHaveBeenCalledWith(
        expect.objectContaining({
          publicKey: 'sam-key',
          joinedAt: '2026-10-24T12:00:01.000Z',
        }),
      ),
    )
  })

  it('is vouched for after the right PIN', async () => {
    vi.mocked(tryPin).mockResolvedValue({ ok: true, vouch: 'encoded-vouch' })
    const user = userEvent.setup()
    const { onIdentified } = renderFlow()

    await user.click(screen.getByRole('button', { name: 'Sam' }))
    await waitFor(() =>
      expect(askForVouch).toHaveBeenCalledWith(worker, ENDPOINT, {
        personKey: 'sam-key',
        deviceLabel: expect.any(String),
      }),
    )
    await user.type(screen.getByLabelText('Your PIN'), '4821')
    await user.click(screen.getByRole('button', { name: 'Use PIN' }))

    expect(tryPin).toHaveBeenCalledWith(ENDPOINT, 'request-1', '4821')
    // The worker checks the vouch against the key the QR link pinned.
    expect(acceptVouch).toHaveBeenCalledWith(worker, 'encoded-vouch', HOST_KEY)
    await waitFor(() => expect(onIdentified).toHaveBeenCalledWith(VOUCHED))
  })

  it('says how many PIN tries are left', async () => {
    vi.mocked(tryPin).mockResolvedValue({
      ok: false,
      error: 'wrong-pin',
      attemptsLeft: 3,
    })
    const user = userEvent.setup()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'Sam' }))
    await user.type(screen.getByLabelText('Your PIN'), '0000')
    await user.click(screen.getByRole('button', { name: 'Use PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wrong PIN. 3 tries left.',
    )
  })

  it('waits for the operator once the PIN is locked', async () => {
    vi.mocked(tryPin).mockResolvedValue({ ok: false, error: 'locked' })
    const user = userEvent.setup()
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'Sam' }))
    await user.type(screen.getByLabelText('Your PIN'), '0000')
    await user.click(screen.getByRole('button', { name: 'Use PIN' }))

    expect(
      await screen.findByText('Waiting for the host to confirm you…'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Your PIN')).not.toBeInTheDocument()
  })

  it('is vouched for once the operator confirms a person without a PIN', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { onIdentified } = renderFlow()

    await user.click(screen.getByRole('button', { name: 'Alex' }))
    expect(
      screen.getByText('Waiting for the host to confirm you…'),
    ).toBeInTheDocument()
    await waitFor(() => expect(askForVouch).toHaveBeenCalled())

    vi.mocked(readVouchStatus).mockResolvedValue({
      status: 'vouched',
      vouch: 'encoded-vouch',
    })
    await act(() => vi.advanceTimersByTimeAsync(VOUCH_POLL_MS))

    await waitFor(() => expect(onIdentified).toHaveBeenCalledWith(VOUCHED))
  })

  it('goes back to the names when the operator says no', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(readVouchStatus).mockResolvedValue({ status: 'rejected' })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderFlow()

    await user.click(screen.getByRole('button', { name: 'Alex' }))
    await waitFor(() => expect(askForVouch).toHaveBeenCalled())
    await act(() => vi.advanceTimersByTimeAsync(VOUCH_POLL_MS))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The host said no.',
    )
    expect(screen.getByRole('button', { name: 'Sam' })).toBeInTheDocument()
  })

  it('refuses a vouch that the pinned host did not sign', async () => {
    vi.mocked(tryPin).mockResolvedValue({ ok: true, vouch: 'encoded-vouch' })
    vi.mocked(acceptVouch).mockResolvedValue({
      ok: false,
      problem: 'other-host',
    })
    const user = userEvent.setup()
    const { onIdentified } = renderFlow()

    await user.click(screen.getByRole('button', { name: 'Sam' }))
    await user.type(screen.getByLabelText('Your PIN'), '4821')
    await user.click(screen.getByRole('button', { name: 'Use PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'did not come from the host you scanned',
    )
    expect(onIdentified).not.toHaveBeenCalled()
  })
})
