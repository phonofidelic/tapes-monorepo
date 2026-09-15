import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { getSyncConnections, getSyncServerInfo } from '@/syncServer'

/**
 * The first snapshot of who is connected to this host.
 *
 * Later changes arrive as events instead, from `connectedDevicesPush`. This
 * channel exists so a panel that has just mounted can show something without
 * waiting for someone to connect or leave.
 */
export class GetConnectedDevicesChannel implements IpcChannel {
  name: string = 'sync:get-connected-devices'

  handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel } = request
    if (!responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    try {
      if (!getSyncServerInfo().running) {
        // A failure, not an empty list. With no server there is no registry to
        // read, which is not the same answer as a registry holding nobody — and
        // a panel handed `[]` here would tell the user nobody is connected when
        // the truth is that this device is not hosting at all.
        event.sender.send(responseChannel, {
          success: false,
          error: new Error('The sync server is not running on this device'),
        })
        return
      }

      event.sender.send(responseChannel, {
        success: true,
        data: { connections: getSyncConnections() },
      })
    } catch (error) {
      // Answering at all is the point. The renderer holds a promise that
      // settles only when a response arrives. Returning quietly here would
      // leave the panel waiting forever.
      console.error(error)
      event.sender.send(responseChannel, { success: false, error })
    }
  }
}
