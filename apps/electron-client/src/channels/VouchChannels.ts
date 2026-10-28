import { asError } from '@/asError'
import { getHostVouching } from '@/syncServer'
import {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * The operator's side of vouching, in the host's own window. The operator sees
 * who is waiting and says yes or no. These run over IPC only, so nothing on
 * the LAN can confirm a request.
 */

const notRunning = (): IpcResponse => ({
  success: false,
  error: new Error('The host is not vouching: no sync server or signing key'),
})

/** The waiting list when the panel mounts. Later changes arrive as events. */
export class GetPendingVouchesChannel implements IpcChannel {
  name: ValidIpcChanel = 'vouch:get-pending'

  handle(): IpcResponse {
    const vouching = getHostVouching()
    return vouching
      ? { success: true, data: { pending: vouching.pending() } }
      : notRunning()
  }
}

function requestId(request: IpcRequest): string | undefined {
  const { id } = (request?.data ?? {}) as { id?: unknown }
  return typeof id === 'string' ? id : undefined
}

/** The operator says the device is the person's. The host signs the vouch. */
export class ConfirmVouchChannel implements IpcChannel {
  name: ValidIpcChanel = 'vouch:confirm'

  async handle(request: IpcRequest): Promise<IpcResponse> {
    const vouching = getHostVouching()
    const id = requestId(request)
    if (!vouching || !id) {
      return notRunning()
    }
    try {
      const vouch = await vouching.confirm(id)
      return vouch
        ? { success: true }
        : {
            success: false,
            error: new Error('That request is no longer waiting'),
          }
    } catch (error) {
      console.error('Could not vouch for a device:', error)
      return { success: false, error: asError(error) }
    }
  }
}

export class RejectVouchChannel implements IpcChannel {
  name: ValidIpcChanel = 'vouch:reject'

  handle(request: IpcRequest): IpcResponse {
    const vouching = getHostVouching()
    const id = requestId(request)
    if (!vouching || !id) {
      return notRunning()
    }
    vouching.reject(id)
    return { success: true }
  }
}
