import { asError } from '@/asError'
import type { HostSession } from '@/hostSession'
import { hostSession } from '@/syncServer'
import {
  HostSessionResponse,
  IpcChannel,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * Closes the host session and clears it from the root document. Its record is
 * signed after the grace period, so this answers before the record exists,
 * with the time it will be signed.
 */
export class StopSessionChannel implements IpcChannel {
  name: ValidIpcChanel = 'session:stop'

  constructor(private session: HostSession = hostSession) {}

  async handle(): Promise<HostSessionResponse> {
    try {
      const closed = await this.session.stop()
      return { success: true, data: closed ? { closed } : {} }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}
