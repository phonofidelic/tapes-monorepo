import { asError } from '@/asError'
import { getSyncConnections, getSyncServerInfo } from '@/syncServer'
import {
  GetConnectedDevicesResponse,
  IpcChannel,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * The first snapshot of who is connected to this host.
 *
 * Later changes arrive as events instead, from `connectedDevicesPush`. This
 * channel exists so a panel that has just mounted can show something without
 * waiting for someone to connect or leave.
 */
export class GetConnectedDevicesChannel implements IpcChannel {
  name: ValidIpcChanel = 'sync:get-connected-devices'

  handle(): GetConnectedDevicesResponse {
    try {
      if (!getSyncServerInfo().running) {
        // A failure, not an empty list. With no server there is no registry to
        // read, which is not the same answer as a registry holding nobody — and
        // a panel handed `[]` here would tell the user nobody is connected when
        // the truth is that this device is not hosting at all.
        return {
          success: false,
          error: new Error('The sync server is not running on this device'),
        }
      }

      return { success: true, data: { connections: getSyncConnections() } }
    } catch (error) {
      // A failure the panel can read, rather than a rejected promise it does
      // not branch on. Both outcomes of this channel are answers.
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}
