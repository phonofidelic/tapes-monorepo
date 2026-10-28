import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterPerson } from '@tapes-monorepo/sync-protocol'
import { AppContextProvider } from '@/context/AppContext'
import type { IpcService, SignedVouch } from '@/IpcService'
import { RosterSettings } from './RosterSettings'

vi.mock('@/utils', () => ({
  useAutomergeUrl: () => ({ automergeUrl: 'automerge:root' }),
}))

const SAM: RosterPerson = {
  personKey: 'sam-key',
  name: 'Sam',
  hasPin: true,
  pinLocked: true,
}

const VOUCH: SignedVouch = {
  address: 'aa'.repeat(32),
  personKey: 'sam-key',
  personName: 'Sam',
  deviceLabel: 'New phone',
  deviceFingerprint: 'ab cd ef',
  method: 'operator',
  vouchedAt: '2026-10-27T18:00:00.000Z',
}

afterEach(() => {
  cleanup()
})

function renderSettings(people: RosterPerson[], vouches: SignedVouch[] = []) {
  const ipc = {
    send: vi.fn((channel: string) =>
      Promise.resolve(
        channel === 'roster:get-people'
          ? { success: true, data: { people } }
          : channel === 'roster:get-vouches'
            ? { success: true, data: { vouches } }
            : { success: true },
      ),
    ),
    subscribe: vi.fn(() => () => {}),
  } as unknown as IpcService
  render(
    <AppContextProvider value={{ type: 'electron-client', ipc }}>
      <RosterSettings />
    </AppContextProvider>,
  )
  return ipc
}

describe('RosterSettings', () => {
  it('shows who is locked out of their PIN', async () => {
    renderSettings([SAM])

    expect(
      await screen.findByText('PIN locked after too many wrong tries'),
    ).toBeInTheDocument()
  })

  it('unlocks a PIN and reads the roster again', async () => {
    const user = userEvent.setup()
    const ipc = renderSettings([SAM])

    await user.click(await screen.findByRole('button', { name: 'Unlock PIN' }))

    expect(ipc.send).toHaveBeenCalledWith('roster:unlock-pin', {
      data: { personKey: 'sam-key' },
    })
    await waitFor(() =>
      expect(
        vi
          .mocked(ipc.send)
          .mock.calls.filter(([channel]) => channel === 'roster:get-people'),
      ).toHaveLength(2),
    )
  })

  it('lets the person type a new PIN on the host', async () => {
    const user = userEvent.setup()
    const ipc = renderSettings([{ ...SAM, pinLocked: false }])

    await user.click(await screen.findByRole('button', { name: 'Change PIN' }))
    await user.type(screen.getByLabelText(/types a new PIN/), '13a57')
    await user.click(screen.getByRole('button', { name: 'Save PIN' }))

    expect(ipc.send).toHaveBeenCalledWith('roster:set-pin', {
      data: { personKey: 'sam-key', pin: '1357' },
    })
  })

  it('removes a PIN', async () => {
    const user = userEvent.setup()
    const ipc = renderSettings([{ ...SAM, pinLocked: false }])

    await user.click(await screen.findByRole('button', { name: 'Remove PIN' }))

    expect(ipc.send).toHaveBeenCalledWith('roster:set-pin', {
      data: { personKey: 'sam-key', pin: null },
    })
  })

  it('withdraws a vouch and reads the roster again', async () => {
    const user = userEvent.setup()
    const ipc = renderSettings([SAM], [VOUCH])

    expect(
      await screen.findByText(/Vouched for “New phone”/),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Withdraw this vouch' }),
    )

    expect(ipc.send).toHaveBeenCalledWith('roster:revoke-vouch', {
      data: { address: VOUCH.address, docUrl: 'automerge:root' },
    })
    await waitFor(() =>
      expect(
        vi
          .mocked(ipc.send)
          .mock.calls.filter(([channel]) => channel === 'roster:get-vouches'),
      ).toHaveLength(2),
    )
  })

  it('offers no button for a vouch already withdrawn', async () => {
    renderSettings([SAM], [{ ...VOUCH, revokedAt: '2026-10-28T09:00:00.000Z' }])

    expect(await screen.findByText('Withdrawn')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Withdraw this vouch' }),
    ).not.toBeInTheDocument()
  })

  it('shows nothing when the roster is empty', async () => {
    const ipc = renderSettings([])
    await waitFor(() => expect(ipc.send).toHaveBeenCalled())
    expect(screen.queryByText('People')).not.toBeInTheDocument()
  })
})
