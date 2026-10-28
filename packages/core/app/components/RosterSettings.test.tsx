import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterPerson } from '@tapes-monorepo/sync-protocol'
import { AppContextProvider } from '@/context/AppContext'
import type { IpcService } from '@/IpcService'
import { RosterSettings } from './RosterSettings'

const SAM: RosterPerson = {
  personKey: 'sam-key',
  name: 'Sam',
  hasPin: true,
  pinLocked: true,
}

afterEach(() => {
  cleanup()
})

function renderSettings(people: RosterPerson[]) {
  const ipc = {
    send: vi.fn((channel: string) =>
      Promise.resolve(
        channel === 'roster:get-people'
          ? { success: true, data: { people } }
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

  it('shows nothing when the roster is empty', async () => {
    const ipc = renderSettings([])
    await waitFor(() => expect(ipc.send).toHaveBeenCalled())
    expect(screen.queryByText('People')).not.toBeInTheDocument()
  })
})
