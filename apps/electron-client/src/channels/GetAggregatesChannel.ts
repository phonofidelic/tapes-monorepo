import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { getAggregateStore } from '../syncServer'

/**
 * The host reading its own numbers, without a round trip through its own HTTP
 * surface.
 *
 * The renderer of a device that hosts its library is in the same process tree
 * as the store, so asking it over the network would mean holding a token and a
 * port to reach a `Map` that is already in memory. A guest, and a host in
 * remote-sync mode, take `GET /events/aggregates` instead — which host to ask
 * is decided in core by `resolveEventTarget`, not here.
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
      // Distinguished from an empty library on purpose: no store means these
      // numbers are unavailable, not that nothing has been played. A caller
      // that conflated the two would render a confident zero on every row.
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
