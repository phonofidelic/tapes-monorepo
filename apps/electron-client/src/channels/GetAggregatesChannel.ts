import { asError } from '@/asError'
import { IpcChannel } from '@/types'
import { getAggregateStore } from '../syncServer'
import { GetAggregatesResponse, ValidIpcChanel } from '@tapes-monorepo/core'

/**
 * Serves this device's own playback numbers to its renderer.
 *
 * The renderer and the store share a process, so a network request would need
 * a port and a token to reach numbers already in memory. Guests and devices in
 * remote sync mode use the HTTP route instead. Core decides which of the two
 * applies; this channel does not.
 */
export class GetAggregatesChannel implements IpcChannel {
  name: ValidIpcChanel = 'events:get-aggregates'

  handle(): GetAggregatesResponse {
    const store = getAggregateStore()
    if (!store) {
      // Reported as a failure, not as an empty library. No store means the
      // numbers are unavailable, not that nothing has been played.
      return {
        success: false,
        error: new Error('Playback aggregates are not available'),
      }
    }

    try {
      return {
        success: true,
        data: {
          aggregates: store.all(),
          generatedAt: new Date().toISOString(),
        },
      }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}
