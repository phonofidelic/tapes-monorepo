import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppContextProvider } from '@/context/AppContext'
import type { IpcService, PendingVouch } from '@/IpcService'
import { PendingVouches } from './PendingVouches'

const SAM: PendingVouch = {
  id: 'request-1',
  personName: 'Sam',
  deviceLabel: 'iPhone · Safari',
  deviceFingerprint: 'AB12-CD34',
  receivedAt: '2026-10-24T18:00:00.000Z',
}

afterEach(() => {
  cleanup()
})

/** A host that answers the snapshot with `pending` and lets a test push. */
function renderPanel(pending: PendingVouch[]) {
  let push: (payload: { pending: PendingVouch[] }) => void = () => {}
  const ipc = {
    send: vi.fn((channel: string) =>
      Promise.resolve(
        channel === 'vouch:get-pending'
          ? { success: true, data: { pending } }
          : { success: true },
      ),
    ),
    subscribe: vi.fn((_event: string, listener: typeof push) => {
      push = listener
      return () => {}
    }),
  } as unknown as IpcService
  render(
    <AppContextProvider value={{ type: 'electron-client', ipc }}>
      <PendingVouches />
    </AppContextProvider>,
  )
  return { ipc, push: (next: PendingVouch[]) => push({ pending: next }) }
}

describe('PendingVouches', () => {
  it('shows who is waiting, with the device and its key', async () => {
    renderPanel([SAM])

    expect(
      await screen.findByRole('region', { name: 'Waiting to join' }),
    ).toHaveTextContent('Sam on “iPhone · Safari”')
    expect(screen.getByText(/Key AB12-CD34/)).toBeInTheDocument()
  })

  it('confirms the person when the operator says yes', async () => {
    const user = userEvent.setup()
    const { ipc } = renderPanel([SAM])

    await user.click(
      await screen.findByRole('button', { name: "Yes, that's Sam" }),
    )

    expect(ipc.send).toHaveBeenCalledWith('vouch:confirm', {
      data: { id: 'request-1' },
    })
  })

  it('rejects the request when the operator says no', async () => {
    const user = userEvent.setup()
    const { ipc } = renderPanel([SAM])

    await user.click(await screen.findByRole('button', { name: 'No' }))

    expect(ipc.send).toHaveBeenCalledWith('vouch:reject', {
      data: { id: 'request-1' },
    })
  })

  it('follows the list the host pushes, and hides when it empties', async () => {
    const { push } = renderPanel([SAM])
    await screen.findByRole('region', { name: 'Waiting to join' })

    act(() => push([]))

    await waitFor(() =>
      expect(screen.queryByRole('region')).not.toBeInTheDocument(),
    )
  })

  it('shows nothing on a web guest', () => {
    render(
      <AppContextProvider value={{ type: 'web-client', worker: {} as Worker }}>
        <PendingVouches />
      </AppContextProvider>,
    )

    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
