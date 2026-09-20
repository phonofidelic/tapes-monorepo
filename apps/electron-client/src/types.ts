import { IpcRequest, ValidIpcChanel } from '@tapes-monorepo/core'

/**
 * One request/response channel the main process serves.
 *
 * A handler returns the answer. Electron sends it back to the renderer that
 * asked, so nothing here names a channel to reply on. A channel whose outcome
 * the caller must tell apart answers with one of core's response unions. A
 * handler that throws rejects the caller's promise, which is a bug.
 */
export type IpcChannel = {
  name: ValidIpcChanel
  handle(request: IpcRequest): unknown
}
