// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'
import type { ValidIpcChanel, ValidIpcEvent } from '@tapes-monorepo/core'

// A Record keyed by the union rather than a hand-kept array: a channel added
// to `ValidIpcChanel` and forgotten here is a `check-types` failure instead of
// a renderer whose requests vanish. The blob channels were missing for exactly
// that reason — `blob:put-file` was dropped here, so a recording made on the
// host never gained a blob descriptor and every guest was told it was still
// uploading.
const CHANNEL_ALLOWLIST: Record<ValidIpcChanel, true> = {
  'settings:set-default-audio-input-device': true,
  'storage:open-directory-dialog': true,
  'storage:edit-recording': true,
  'storage:delete-recording': true,
  'storage:read-file': true,
  'recorder:start': true,
  'recorder:stop': true,
  'sync:get-server-info': true,
  'sync:get-connected-devices': true,
  'sync:set-lan-enabled': true,
  'sync:set-https-enabled': true,
  'blob:put-file': true,
  'blob:has': true,
  'blob:cache-put': true,
  'library:announce': true,
  'events:get-aggregates': true,
}

// Main-process events the renderer may listen for. Nothing asked for these and
// they arrive repeatedly, so they are not answers to a request and need their
// own list. Keyed by the union for the same reason as the channels. An event
// forgotten here fails check-types instead of becoming a listener that never
// fires.
const EVENT_ALLOWLIST: Record<ValidIpcEvent, true> = {
  'sync:connected-devices': true,
}

const validChannels = Object.keys(CHANNEL_ALLOWLIST) as ValidIpcChanel[]

const validEvents = Object.keys(EVENT_ALLOWLIST) as ValidIpcEvent[]

const api = {
  invoke: (channel: ValidIpcChanel, data: unknown) => {
    // Throwing rather than returning: the caller holds a promise for the
    // answer, so dropping the message silently would hang it forever.
    if (!validChannels.includes(channel)) {
      throw new Error(`Blocked ipc message on unknown channel: ${channel}`)
    }
    return ipcRenderer.invoke(channel, data)
  },
  subscribe: (event: ValidIpcEvent, func: (...args: unknown[]) => void) => {
    if (!validEvents.includes(event)) {
      throw new Error(`Blocked ipc listener on unknown event: ${event}`)
    }
    // Deliberately strip event as it includes `sender`
    const forward = (_event: unknown, ...args: unknown[]) =>
      func(...(args as Parameters<typeof func>))
    ipcRenderer.on(event, forward)
    // Events are the only thing here that registers a listener, so they are the
    // only thing that needs an unsubscribe. Without this, every remount of a
    // panel adds another listener for the life of the window.
    return () => {
      ipcRenderer.removeListener(event, forward)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
