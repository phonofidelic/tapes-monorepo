import type { HostSession } from '@/hostSession'
import { hostSession } from '@/syncServer'
import {
  HostSessionResponse,
  IpcChannel,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/** The open host session, read from memory rather than from the doc. */
export class GetCurrentSessionChannel implements IpcChannel {
  name: ValidIpcChanel = 'session:get-current'

  constructor(private session: HostSession = hostSession) {}

  handle(): HostSessionResponse {
    return { success: true, data: { session: this.session.current() } }
  }
}
