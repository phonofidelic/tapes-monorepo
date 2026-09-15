import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The push is the only reason the presence list can be trusted between
 * requests. If a change never leaves the main process, the panel shows whoever
 * was connected when it mounted and goes on showing them — which is exactly the
 * stale list this seam exists to remove.
 */

const { onSyncConnectionsChange } = vi.hoisted(() => ({
  onSyncConnectionsChange: vi.fn(),
}))

vi.mock('./syncServer', () => ({ onSyncConnectionsChange }))

let emit: (connections: unknown[]) => void
let unsubscribe: ReturnType<typeof vi.fn>

beforeEach(() => {
  unsubscribe = vi.fn()
  onSyncConnectionsChange.mockReset()
  onSyncConnectionsChange.mockImplementation(
    (listener: (connections: unknown[]) => void) => {
      emit = listener
      return unsubscribe
    },
  )
})

function target() {
  return { isDestroyed: vi.fn(() => false), send: vi.fn() }
}

const A_PHONE = {
  id: 'sync-connection-1',
  label: 'Studio phone',
  address: '192.168.1.24',
  connectedAt: 1758000000000,
  self: false,
}

describe('the connected-devices push', () => {
  it('sends the new list to the window on every change', async () => {
    const { startConnectedDevicesPush, CONNECTED_DEVICES_EVENT } =
      await import('./connectedDevicesPush')
    const window = target()
    startConnectedDevicesPush(() => window)

    emit([A_PHONE])

    expect(window.send).toHaveBeenCalledWith(CONNECTED_DEVICES_EVENT, {
      connections: [A_PHONE],
    })
  })

  // An empty list is a real answer here: the last guest left. The renderer has
  // already been told the host is running, so it can show "nobody" honestly.
  it('sends an empty list when the last connection goes', async () => {
    const { startConnectedDevicesPush, CONNECTED_DEVICES_EVENT } =
      await import('./connectedDevicesPush')
    const window = target()
    startConnectedDevicesPush(() => window)

    emit([])

    expect(window.send).toHaveBeenCalledWith(CONNECTED_DEVICES_EVENT, {
      connections: [],
    })
  })

  // The window is rebuilt when the dock icon is clicked, so the target is
  // resolved per event rather than captured when the push starts.
  it('sends to whichever window exists at the time', async () => {
    const { startConnectedDevicesPush } = await import('./connectedDevicesPush')
    const first = target()
    const second = target()
    let current = first
    startConnectedDevicesPush(() => current)

    emit([A_PHONE])
    current = second
    emit([])

    expect(first.send).toHaveBeenCalledTimes(1)
    expect(second.send).toHaveBeenCalledTimes(1)
  })

  it('drops the event when there is no window', async () => {
    const { startConnectedDevicesPush } = await import('./connectedDevicesPush')
    startConnectedDevicesPush(() => null)

    expect(() => emit([A_PHONE])).not.toThrow()
  })

  // Sending to destroyed webContents throws. A quit mid-change must not take
  // the process with it.
  it('drops the event when the window is destroyed', async () => {
    const { startConnectedDevicesPush } = await import('./connectedDevicesPush')
    const window = target()
    window.isDestroyed.mockReturnValue(true)
    startConnectedDevicesPush(() => window)

    emit([A_PHONE])

    expect(window.send).not.toHaveBeenCalled()
  })

  it('survives a window torn down between the check and the send', async () => {
    const { startConnectedDevicesPush } = await import('./connectedDevicesPush')
    const window = target()
    window.send.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    startConnectedDevicesPush(() => window)

    expect(() => emit([A_PHONE])).not.toThrow()
  })

  it('returns the registry unsubscribe', async () => {
    const { startConnectedDevicesPush } = await import('./connectedDevicesPush')

    expect(startConnectedDevicesPush(() => target())).toBe(unsubscribe)
  })
})
