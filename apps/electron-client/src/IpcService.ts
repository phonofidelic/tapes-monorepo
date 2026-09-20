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

    if (!this.ipcRenderer) {
      throw new Error(
        `Unable to send ipc message: ipcRenderer was not initialized.`,
      )
    }

    // Electron pairs the request with its answer and drops the pairing once it
    // arrives. Two requests on one channel in the same tick cannot be confused,
    // and neither leaves a listener behind.
    return this.ipcRenderer.invoke(channel, request) as Promise<T>
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
