// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'

const validChannels: string[] = []

const validResponseChannels = validChannels.map(
  (channel) => `${channel}:response:.*`,
)

const api = {
  send: (channel: string, data: unknown) => {
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
