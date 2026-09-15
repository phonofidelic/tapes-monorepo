import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainEvent } from 'electron'
import { GetConnectedDevicesChannel } from './GetConnectedDevicesChannel'
import { getSyncConnections, getSyncServerInfo } from '@/syncServer'

/**
 * The snapshot the panel asks for when it mounts.
 *
 * What these mostly guard is the difference between an empty list and no
 * answer. They read the same on screen — a panel with nobody in it — and mean
 * opposite things: "nobody has joined" versus "this device is not hosting" or
 * "the call failed". TAP-88 is the same confusion on the LAN and HTTPS toggles,
 * where a channel that answered with nothing left the switch looking fine.
 */

vi.mock('@/syncServer', () => ({
  getSyncConnections: vi.fn(),
  getSyncServerInfo: vi.fn(),
}))

const RESPONSE_CHANNEL = 'sync:get-connected-devices:response:1758000000000'

const A_PHONE = {
  id: 'sync-connection-1',
  label: 'Studio phone',
  address: '192.168.1.24',
  connectedAt: 1758000000000,
  self: false,
}

function ipcEvent() {
  return { sender: { send: vi.fn() } } as unknown as IpcMainEvent & {
    sender: { send: ReturnType<typeof vi.fn> }
  }
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
    const event = ipcEvent()

    new GetConnectedDevicesChannel().handle(event, {
      responseChannel: RESPONSE_CHANNEL,
    })

    expect(event.sender.send).toHaveBeenCalledWith(RESPONSE_CHANNEL, {
      success: true,
      data: { connections: [A_PHONE] },
    })
  })

  it('answers a running host with nobody on it as a success', () => {
    vi.mocked(getSyncServerInfo).mockReturnValue(running)
    vi.mocked(getSyncConnections).mockReturnValue([])
    const event = ipcEvent()

    new GetConnectedDevicesChannel().handle(event, {
      responseChannel: RESPONSE_CHANNEL,
    })

    expect(event.sender.send).toHaveBeenCalledWith(RESPONSE_CHANNEL, {
      success: true,
      data: { connections: [] },
    })
  })

  // The case that must not come back as an empty list.
  it('reports a stopped server as a failure, not as nobody connected', () => {
    vi.mocked(getSyncServerInfo).mockReturnValue(stopped)
    const event = ipcEvent()

    new GetConnectedDevicesChannel().handle(event, {
      responseChannel: RESPONSE_CHANNEL,
    })

    const [, response] = event.sender.send.mock.calls[0]
    expect(response.success).toBe(false)
    expect(response.error).toBeInstanceOf(Error)
    expect(getSyncConnections).not.toHaveBeenCalled()
  })

  // `IpcService.send` resolves only when a response arrives, so a handler that
  // throws its way out leaves the panel awaiting a promise that never settles.
  it('answers rather than throwing when the registry read fails', () => {
    vi.mocked(getSyncServerInfo).mockReturnValue(running)
    vi.mocked(getSyncConnections).mockImplementation(() => {
      throw new Error('registry unavailable')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = ipcEvent()

    new GetConnectedDevicesChannel().handle(event, {
      responseChannel: RESPONSE_CHANNEL,
    })

    const [, response] = event.sender.send.mock.calls[0]
    expect(response.success).toBe(false)
  })

  it('throws when no response channel was provided', () => {
    vi.mocked(getSyncServerInfo).mockReturnValue(running)

    expect(() =>
      new GetConnectedDevicesChannel().handle(ipcEvent(), {}),
    ).toThrow(/No response channel/)
  })
})
