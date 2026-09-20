import { IpcSendArgs, IpcService, ValidIpcEvent } from '@tapes-monorepo/core'

export class ElectronIpcService implements IpcService {
  private ipcRenderer?: Window['api']

  private initializeIpcRenderer() {
    if (!window || !window.api) {
      throw new Error(`Unable to require renderer process`)
    }
    this.ipcRenderer = window.api
  }

  public send<T>(...[channel, request = {}]: IpcSendArgs): Promise<T> {
    // If the ipcRenderer is not available try to initialize it
    if (!this.ipcRenderer) {
      this.initializeIpcRenderer()
    }
    // If there's no specific responseChannel, generate one with a timestamp
    if (!request.responseChannel) {
      request.responseChannel = `${channel}:response:${Date.now()}`
    }

    if (!this.ipcRenderer) {
      throw new Error(
        `Unable to send ipc message: ipcRenderer was not initialized.`,
      )
    }

    const ipcRenderer = this.ipcRenderer

    try {
      ipcRenderer.send(channel, request)
    } catch (error) {
      throw new Error(
        `Unable to send ipc message: ${error}. Channel: ${channel}`,
      )
    }

    // This method returns a promise which will be resolved when the response has arrived.
    return new Promise((resolve) => {
      ipcRenderer.receive(
        request.responseChannel ?? '',
        (...args: unknown[]) => {
          resolve(args[0] as T)
        },
      )
    })
  }

  /**
   * Listens for a main-process event and returns the unsubscribe.
   *
   * Nothing here resolves or rejects. A caller that needs a starting value must
   * also request one with `send`. Subscribe first and request second. A change
   * that lands between the two is otherwise lost.
   */
  public subscribe<T>(
    event: ValidIpcEvent,
    listener: (payload: T) => void,
  ): () => void {
    if (!this.ipcRenderer) {
      this.initializeIpcRenderer()
    }

    if (!this.ipcRenderer) {
      throw new Error(
        `Unable to subscribe to ipc event: ipcRenderer was not initialized.`,
      )
    }

    return this.ipcRenderer.subscribe(event, (...args: unknown[]) => {
      listener(args[0] as T)
    })
  }
}
