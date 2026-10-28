import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterPerson } from '@tapes-monorepo/sync-protocol'
import { changePin, fetchRoster, joinHostRoster } from '@/rosterClient'
import type { PersonKeyStatus } from '@/personKey'
import { PinSettings } from './PinSettings'

vi.mock('@/rosterClient', () => ({
  changePin: vi.fn(),
  fetchRoster: vi.fn(),
  joinHostRoster: vi.fn(),
}))

const ENDPOINT = { baseUrl: 'https://host.local:9000', token: 't' }
const SAM: RosterPerson = {
  personKey: 'sam-key',
  name: 'Sam',
  hasPin: true,
  pinLocked: false,
}
const HOLDS_KEY: Extract<PersonKeyStatus, { exists: true }> = {
  exists: true,
  publicKey: 'sam-key',
  certificate: 'cert',
  certificateAddress: 'address',
  joinedAt: '2026-10-28T08:00:00.000Z',
}
const VOUCHED = { ...HOLDS_KEY, vouchedBy: 'Studio Mac' }

beforeEach(() => {
  vi.mocked(fetchRoster).mockResolvedValue([SAM])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const worker = {} as Worker

const renderPin = (status: Extract<PersonKeyStatus, { exists: true }>) =>
  render(<PinSettings worker={worker} endpoint={ENDPOINT} status={status} />)

describe('PinSettings', () => {
  it('changes the PIN by joining again when the device has the person key', async () => {
    const user = userEvent.setup()
    vi.mocked(joinHostRoster).mockResolvedValue({
      ok: true,
      joinedAt: '2026-10-28T09:00:00.000Z',
    })
    renderPin(HOLDS_KEY)

    expect(screen.queryByLabelText('Current PIN')).not.toBeInTheDocument()
    await user.type(await screen.findByLabelText(/New PIN/), '2468')
    await user.click(screen.getByRole('button', { name: 'Change PIN' }))

    expect(joinHostRoster).toHaveBeenCalledWith(worker, ENDPOINT, {
      personName: 'Sam',
      pin: '2468',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your PIN is saved.',
    )
  })

  it('asks a vouched device for the old PIN', async () => {
    const user = userEvent.setup()
    vi.mocked(changePin).mockResolvedValue({ ok: true })
    renderPin(VOUCHED)

    await user.type(await screen.findByLabelText('Current PIN'), '4821')
    await user.click(screen.getByRole('button', { name: 'Remove PIN' }))

    expect(changePin).toHaveBeenCalledWith(ENDPOINT, {
      personKey: 'sam-key',
      oldPin: '4821',
      pin: null,
    })
  })

  it('says how many tries are left after a wrong old PIN', async () => {
    const user = userEvent.setup()
    vi.mocked(changePin).mockResolvedValue({
      ok: false,
      error: 'wrong-pin',
      attemptsLeft: 2,
    })
    renderPin(VOUCHED)

    await user.type(await screen.findByLabelText('Current PIN'), '0000')
    await user.type(screen.getByLabelText(/New PIN/), '2468')
    await user.click(screen.getByRole('button', { name: 'Change PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('2 tries left')
  })

  it('sends a locked vouched device to the host', async () => {
    vi.mocked(fetchRoster).mockResolvedValue([{ ...SAM, pinLocked: true }])
    renderPin(VOUCHED)

    expect(
      await screen.findByText(/Ask the host in person to\s+unlock it/),
    ).toBeInTheDocument()
  })

  it('shows nothing for a person not on the roster', async () => {
    vi.mocked(fetchRoster).mockResolvedValue([])
    const { container } = await act(async () => renderPin(HOLDS_KEY))
    expect(fetchRoster).toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
