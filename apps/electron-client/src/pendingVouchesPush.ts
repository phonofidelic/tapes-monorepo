import type { PendingVouchesEvent, ValidIpcEvent } from '@tapes-monorepo/core'
import { subscribeToPendingVouches } from './syncServer'

/**
 * Sends the list of devices waiting for the operator to the host's window, as
 * it changes. A guest is standing there waiting, so the panel must not poll.
 *
 * Each event carries the whole list, like the connected-devices push. The
 * window is looked up per event for the same reason given there.
 */
export const PENDING_VOUCHES_EVENT: ValidIpcEvent = 'vouch:pending'

export type PendingVouchesTarget = {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export function startPendingVouchesPush(
  getTarget: () => PendingVouchesTarget | null | undefined,
): () => void {
  return subscribeToPendingVouches((pending) => {
    const target = getTarget()
    if (!target || target.isDestroyed()) {
      return
    }
    const payload: PendingVouchesEvent = { pending }
    try {
      target.send(PENDING_VOUCHES_EVENT, payload)
    } catch (error) {
      // The window went away mid-send. A new one asks for a snapshot.
      console.error('Failed to push pending vouches to the renderer:', error)
    }
  })
}
