import { asError } from '@/asError'
import type { HostSession } from '@/hostSession'
import { hostSession } from '@/syncServer'
import {
  HostSessionResponse,
  IpcChannel,
  IpcRequest,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * Opens a host session on the renderer's root document. The host makes the
 * session ID and publishes it in that document.
 */
export class StartSessionChannel implements IpcChannel {
  name: ValidIpcChanel = 'session:start'

  constructor(private session: HostSession = hostSession) {}

  async handle(request: IpcRequest): Promise<HostSessionResponse> {
    const { data } = request
    if (!isValidStartSessionRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    try {
      return {
        success: true,
        data: { session: await this.session.start(data.docUrl) },
      }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}

const isValidStartSessionRequestData = (
  data: unknown,
): data is { docUrl: string } =>
  typeof data === 'object' &&
  data !== null &&
  'docUrl' in data &&
  typeof data.docUrl === 'string' &&
  data.docUrl.startsWith('automerge:')
