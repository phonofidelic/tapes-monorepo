import type { SessionSettledEvent, ValidIpcEvent } from '@tapes-monorepo/core'
import type { HostSession } from './hostSession'
import type { ConnectedDevicesTarget } from './connectedDevicesPush'

/**
 * Tells the renderer when a stopped session's record is signed or has failed.
 * Signing finishes a grace period after the stop answered, so it cannot be
 * part of that answer. The window is looked up per event, as in
 * `connectedDevicesPush.ts`.
 */
export const SESSION_SETTLED_EVENT: ValidIpcEvent = 'session:settled'

export function startSessionSettledPush(
  session: Pick<HostSession, 'onSettled'>,
  getTarget: () => ConnectedDevicesTarget | null | undefined,
): () => void {
  return session.onSettled((event: SessionSettledEvent) => {
    const target = getTarget()
    if (!target || target.isDestroyed()) {
      return
    }
    try {
      target.send(SESSION_SETTLED_EVENT, event)
    } catch (error) {
      console.error('Failed to push a settled session to the renderer:', error)
    }
  })
}
