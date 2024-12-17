import { IpcMainEvent } from 'electron'

export type IpcRequest = {
  responseChannel?: string
  params?: string[]
  data?: unknown
}

export type IpcChannel = {
  name: string
  handle(event: IpcMainEvent, request: IpcRequest): void
}
