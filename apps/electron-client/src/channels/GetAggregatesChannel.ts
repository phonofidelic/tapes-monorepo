import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { getAggregateStore } from '../syncServer'

/**
 * Serves this device's own playback numbers to its renderer.
 *
 * The renderer and the store share a process, so a network request would need
 * a port and a token to reach numbers already in memory. Guests and devices in
 * remote sync mode use the HTTP route instead. Core decides which of the two
 * applies; this channel does not.
 */
export class GetAggregatesChannel implements IpcChannel {
  name: string = 'events:get-aggregates'

  handle(event: IpcMainEvent, request: IpcRequest) {
    const { responseChannel } = request
    if (!responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    const store = getAggregateStore()
    if (!store) {
      // Reported as a failure, not as an empty library. No store means the
      // numbers are unavailable, not that nothing has been played.
      event.sender.send(responseChannel, {
        success: false,
        error: new Error('Playback aggregates are not available'),
      })
      return
    }

    try {
      event.sender.send(responseChannel, {
        success: true,
        data: {
          aggregates: store.all(),
          generatedAt: new Date().toISOString(),
        },
      })
    } catch (error) {
      console.error(error)
      event.sender.send(responseChannel, { success: false, error })
    }
  }
}
