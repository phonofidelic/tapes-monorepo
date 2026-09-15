import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AppContextProvider } from '@/context/AppContext'
import { useConnectedDevices } from '@/useConnectedDevices'
import type { IpcService } from '@/IpcService'

/**
 * What the panel is allowed to believe about who is connected.
 *
 * The list itself is easy. The states around it are the ones that mislead: a
 * host that cannot answer must never read as a host nobody has joined.
 */

const A_PHONE = {
  id: 'sync-connection-1',
  label: 'Studio phone',
  address: '192.168.1.24',
  connectedAt: 1758000000000,
  self: false,
}

const worker = { postMessage: () => {} } as unknown as Worker

function Probe() {
  const { connections, status } = useConnectedDevices()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="labels">
        {connections.map((connection) => connection.label).join(',')}
      </span>
    </div>
  )
}

/** A stand-in IpcService, with a handle on the pushed-event listener. */
function fakeIpc(response: unknown | Promise<unknown>) {
  const listeners: ((payload: unknown) => void)[] = []
  const unsubscribe = vi.fn()
  const ipc = {
    send: vi.fn(() => Promise.resolve(response)),
    subscribe: vi.fn((_event: string, listener: (payload: unknown) => void) => {
      listeners.push(listener)
      return unsubscribe
    }),
  } as unknown as IpcService
  return {
    ipc,
    unsubscribe,
    push: (payload: unknown) => listeners.forEach((l) => l(payload)),
    listenerCount: () => listeners.length,
  }
}

function renderWithIpc(ipc: IpcService) {
  return render(
    <AppContextProvider value={{ type: 'electron-client', ipc }}>
      <Probe />
    </AppContextProvider>,
  )
}

describe('useConnectedDevices', () => {
  it('shows the snapshot the host answers with', async () => {
    const { ipc } = fakeIpc({
      success: true,
      data: { connections: [A_PHONE] },
    })
    renderWithIpc(ipc)

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('ready'),
    )
    expect(screen.getByTestId('labels')).toHaveTextContent('Studio phone')
  })

  it('replaces the list when the host pushes a change', async () => {
    const { ipc, push } = fakeIpc({
      success: true,
      data: { connections: [A_PHONE] },
    })
    renderWithIpc(ipc)
    await waitFor(() =>
      expect(screen.getByTestId('labels')).toHaveTextContent('Studio phone'),
    )

    push({ connections: [] })

    await waitFor(() =>
      expect(screen.getByTestId('labels')).toHaveTextContent(''),
    )
    expect(screen.getByTestId('status')).toHaveTextContent('ready')
  })

  // The subscription has to be in place before the snapshot is requested, or a
  // change landing in between is lost and the list stays wrong until the next
  // unrelated one.
  it('subscribes before it requests the snapshot', () => {
    const { ipc } = fakeIpc({ success: true, data: { connections: [] } })
    renderWithIpc(ipc)

    const subscribedAt = vi.mocked(ipc.subscribe).mock.invocationCallOrder[0]
    const sentAt = vi.mocked(ipc.send).mock.invocationCallOrder[0]
    expect(subscribedAt).toBeLessThan(sentAt)
  })

  it('reports a failed answer as unavailable, not as an empty list', async () => {
    const { ipc } = fakeIpc({
      success: false,
      error: new Error('The sync server is not running on this device'),
    })
    renderWithIpc(ipc)

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unavailable'),
    )
  })

  // The TAP-88 shape: a channel that answers with nothing at all.
  it('reports an empty response as unavailable', async () => {
    const { ipc } = fakeIpc(undefined)
    renderWithIpc(ipc)

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unavailable'),
    )
  })

  // A push that lands first is the truth. A failing snapshot arriving after it
  // must not wipe a list we know is real.
  it('keeps a pushed list when the snapshot then fails', async () => {
    const { ipc, push } = fakeIpc(undefined)
    renderWithIpc(ipc)
    push({ connections: [A_PHONE] })

    await waitFor(() =>
      expect(screen.getByTestId('labels')).toHaveTextContent('Studio phone'),
    )
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('ready'),
    )
  })

  it('unsubscribes when the panel unmounts', async () => {
    const { ipc, unsubscribe } = fakeIpc({
      success: true,
      data: { connections: [] },
    })
    const { unmount } = renderWithIpc(ipc)
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('ready'),
    )

    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })

  // Only the desktop app hosts. A guest has no registry to read, and must not
  // be shown an empty guest list of its own.
  it('reports unsupported off the desktop app', () => {
    render(
      <AppContextProvider value={{ type: 'web-client', worker }}>
        <Probe />
      </AppContextProvider>,
    )

    expect(screen.getByTestId('status')).toHaveTextContent('unsupported')
  })
})
