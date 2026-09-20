import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GetConnectedDevicesChannel } from './GetConnectedDevicesChannel'
import { getSyncConnections, getSyncServerInfo } from '@/syncServer'

/**
 * The snapshot a panel asks for when it mounts.
 *
 * These mostly guard the difference between an empty list and no answer. Both
 * show as a panel with nobody in it. One means nobody has joined. The other
 * means this device is not hosting, or the call failed.
 */

vi.mock('@/syncServer', () => ({
  getSyncConnections: vi.fn(),
  getSyncServerInfo: vi.fn(),
}))

const A_PHONE = {
  id: 'sync-connection-1',
  label: 'Studio phone',
  address: '192.168.1.24',
  connectedAt: 1758000000000,
  self: false,
}

const running = {
  running: true,
  url: 'ws://127.0.0.1:9001',
  port: 9001,
  host: '127.0.0.1',
}
const stopped = { running: false, url: '', port: 0, host: '' }

beforeEach(() => {
  vi.mocked(getSyncServerInfo).mockReset()
  vi.mocked(getSyncConnections).mockReset()
})

describe('the connected-devices channel', () => {
  it('answers with the registry snapshot', () => {
    vi.mocked(getSyncServerInfo).mockReturnValue(running)
    vi.mocked(getSyncConnections).mockReturnValue([A_PHONE])

    expect(new GetConnectedDevicesChannel().handle()).toEqual({
      success: true,
      data: { connections: [A_PHONE] },
    })
  })

  it('answers a running host with nobody on it as a success', () => {
    vi.mocked(getSyncServerInfo).mockReturnValue(running)
    vi.mocked(getSyncConnections).mockReturnValue([])

    expect(new GetConnectedDevicesChannel().handle()).toEqual({
      success: true,
      data: { connections: [] },
    })
  })

  // The case that must never come back as an empty list.
  it('reports a stopped server as a failure, not as nobody connected', () => {
    vi.mocked(getSyncServerInfo).mockReturnValue(stopped)

    expect(new GetConnectedDevicesChannel().handle()).toEqual({
      success: false,
      error: expect.any(Error),
    })
    expect(getSyncConnections).not.toHaveBeenCalled()
  })

  // Both outcomes of this channel are answers. A rejected promise would reach a
  // caller that only branches on `success`.
  it('answers rather than throwing when the registry read fails', () => {
    vi.mocked(getSyncServerInfo).mockReturnValue(running)
    vi.mocked(getSyncConnections).mockImplementation(() => {
      throw new Error('registry unavailable')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(new GetConnectedDevicesChannel().handle()).toEqual({
      success: false,
      error: expect.any(Error),
    })
  })
})
