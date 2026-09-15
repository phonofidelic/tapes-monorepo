import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainEvent } from 'electron'
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

  // The case that must never come back as an empty list.
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

  // The renderer's promise settles only when a response arrives. A handler
  // that throws its way out leaves the panel waiting forever.
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
