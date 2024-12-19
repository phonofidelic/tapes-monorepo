// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'
import { ValidIpcChanel } from '@tapes-monorepo/core'

const validChannels: ValidIpcChanel[] = [
  'storage:open-directory-dialog',
  'storage:edit-recording',
  'recorder:start',
  'recorder:stop',
]

const validResponseChannels = validChannels.map(
  (channel) => `${channel}:response:.*`,
)

const api = {
  send: (channel: ValidIpcChanel, data: unknown) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    if (
      validResponseChannels
        .map((responseChannel) => RegExp(responseChannel).test(channel))
        .includes(true)
    ) {
      // Deliberately strip event as it includes `sender`
      ipcRenderer.on(channel, (_event, ...args: unknown[]) =>
        func(...(args as Parameters<typeof func>)),
      )
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
