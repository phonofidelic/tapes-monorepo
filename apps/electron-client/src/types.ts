import { IpcRequest } from '@tapes-monorepo/core'
import { IpcMainEvent } from 'electron'

export type IpcChannel = {
  name: string
  handle(event: IpcMainEvent, request: IpcRequest): void
}
