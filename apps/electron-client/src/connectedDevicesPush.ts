import type { ValidIpcEvent } from '@tapes-monorepo/core'
import { onSyncConnectionsChange } from './syncServer'
import type { SyncConnection } from './syncConnections'

/**
 * Pushes connection changes from the host's registry to the renderer.
 *
 * Every other IPC path in this app is request/response, which would make the
 * panel poll, and a polled presence list is stale between ticks by definition:
 * a phone that left is still shown as here until the next one. So connects,
 * disconnects and keepalive evictions are sent as they happen instead.
 *
 * One event carrying the whole new list, never a delta. A renderer that misses
 * one — because it was reloading, or its window had not been created yet — is
 * corrected by the next change, and by the `sync:get-connected-devices`
 * snapshot it requests on mount.
 */
export const CONNECTED_DEVICES_EVENT: ValidIpcEvent = 'sync:connected-devices'

/** The part of a `WebContents` this needs. Narrowed so tests can stand one in. */
export type ConnectedDevicesTarget = {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

/**
 * Subscribes to the registry and forwards every change to whatever window
 * `getTarget` currently returns. Returns the unsubscribe.
 *
 * The target is resolved per event rather than captured once: the window is
 * closed and rebuilt on macOS when the dock icon is clicked, and a captured
 * `webContents` would go on receiving events for a window nobody can see.
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
      // A window torn down between the check above and the send. Nothing to
      // recover: the next renderer asks for a snapshot when it mounts.
      console.error('Failed to push connected devices to the renderer:', error)
    }
  })
}
