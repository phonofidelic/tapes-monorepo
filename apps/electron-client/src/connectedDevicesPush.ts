import type { ValidIpcEvent } from '@tapes-monorepo/core'
import { onSyncConnectionsChange } from './syncServer'
import type { SyncConnection } from './syncConnections'

/**
 * Sends connection changes from the host's registry to the renderer.
 *
 * Every other IPC path here is request/response, which would make the panel
 * poll. A polled list keeps showing a device that has already left until the
 * next request. Connects, disconnects and evictions are sent as they happen.
 *
 * Each event carries the whole list, never a delta. A renderer that misses one
 * recovers on the next change, or from the snapshot it requests on mount.
 */
export const CONNECTED_DEVICES_EVENT: ValidIpcEvent = 'sync:connected-devices'

/** The part of a window's web contents this needs. Narrowed so tests can fake it. */
export type ConnectedDevicesTarget = {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

/**
 * Subscribes to the registry and forwards every change to the current window.
 * Returns the unsubscribe.
 *
 * The window is looked up per event rather than captured once. On macOS it is
 * closed and rebuilt when the dock icon is clicked. A captured reference would
 * keep sending to a window nobody can see.
 */
export function startConnectedDevicesPush(
  getTarget: () => ConnectedDevicesTarget | null | undefined,
): () => void {
  return onSyncConnectionsChange((connections: SyncConnection[]) => {
    const target = getTarget()
    if (!target || target.isDestroyed()) {
      return
    }
    try {
      target.send(CONNECTED_DEVICES_EVENT, { connections })
    } catch (error) {
      // The window was torn down between the check above and the send. The
      // next renderer asks for a snapshot when it mounts, so nothing is lost.
      console.error('Failed to push connected devices to the renderer:', error)
    }
  })
}
