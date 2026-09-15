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

// Main-process events the renderer may listen for. Kept apart from the
// request/response allowlist above because these are not responses: they carry
// no `:response:<timestamp>` suffix and arrive repeatedly, unprompted. Keyed by
// the union for the same reason as the channels — a new event forgotten here
// would be a listener that never fires rather than a type error.
const EVENT_ALLOWLIST: Record<ValidIpcEvent, true> = {
  'sync:connected-devices': true,
}

const validChannels = Object.keys(CHANNEL_ALLOWLIST) as ValidIpcChanel[]

const validEvents = Object.keys(EVENT_ALLOWLIST) as ValidIpcEvent[]

const validResponseChannels = validChannels.map(
  (channel) => `${channel}:response:.*`,
)

const api = {
  send: (channel: ValidIpcChanel, data: unknown) => {
    // Throwing rather than returning: `IpcService.send` hands the caller a
    // promise that only ever settles when the response arrives, so dropping
    // the message silently hangs the caller forever.
    if (!validChannels.includes(channel)) {
      throw new Error(`Blocked ipc message on unknown channel: ${channel}`)
    }
    ipcRenderer.send(channel, data)
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    if (
      !validResponseChannels.some((responseChannel) =>
        RegExp(`^${responseChannel}$`).test(channel),
      )
    ) {
      throw new Error(`Blocked ipc listener on unknown channel: ${channel}`)
    }
    // Deliberately strip event as it includes `sender`
    ipcRenderer.on(channel, (_event, ...args: unknown[]) =>
      func(...(args as Parameters<typeof func>)),
    )
  },
  subscribe: (event: ValidIpcEvent, func: (...args: unknown[]) => void) => {
    if (!validEvents.includes(event)) {
      throw new Error(`Blocked ipc listener on unknown event: ${event}`)
    }
    // Deliberately strip event as it includes `sender`
    const forward = (_event: unknown, ...args: unknown[]) =>
      func(...(args as Parameters<typeof func>))
    ipcRenderer.on(event, forward)
    // An unsubscribe, which `receive` has no need of: a response listener fires
    // once and the request is over, but a subscriber outlives nothing on its
    // own. Without this, every remount of the panel would add another listener
    // to the same event and the renderer would leak them for the life of the
    // window.
    return () => {
      ipcRenderer.removeListener(event, forward)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
