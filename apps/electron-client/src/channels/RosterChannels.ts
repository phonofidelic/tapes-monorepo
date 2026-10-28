import { asError } from '@/asError'
import { getHostVouching } from '@/syncServer'
import {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * The operator's controls over the roster, in the host's own window. The
 * operator checks who is asking in person, then unlocks their PIN, sets a new
 * one, or withdraws a vouch the host signed for the wrong person. These run
 * over IPC only, so nothing on the LAN can reach them.
 */

const notRunning = (): IpcResponse => ({
  success: false,
  error: new Error('The host has no roster: no sync server or signing key'),
})

function personKeyOf(request: IpcRequest): string | undefined {
  const { personKey } = (request?.data ?? {}) as { personKey?: unknown }
  return typeof personKey === 'string' ? personKey : undefined
}

/** The people on the roster, with whether each PIN is set or locked. */
export class GetRosterPeopleChannel implements IpcChannel {
  name: ValidIpcChanel = 'roster:get-people'

  async handle(): Promise<IpcResponse> {
    const vouching = getHostVouching()
    if (!vouching) {
      return notRunning()
    }
    try {
      return { success: true, data: { people: await vouching.roster() } }
    } catch (error) {
      console.error('Could not read the roster:', error)
      return { success: false, error: asError(error) }
    }
  }
}

export class UnlockPinChannel implements IpcChannel {
  name: ValidIpcChanel = 'roster:unlock-pin'

  async handle(request: IpcRequest): Promise<IpcResponse> {
    const vouching = getHostVouching()
    const personKey = personKeyOf(request)
    if (!vouching || !personKey) {
      return notRunning()
    }
    try {
      return (await vouching.unlockPin(personKey))
        ? { success: true }
        : {
            success: false,
            error: new Error('That person is not on the roster'),
          }
    } catch (error) {
      console.error('Could not unlock a PIN:', error)
      return { success: false, error: asError(error) }
    }
  }
}

/** Sets a new PIN, or removes it when `pin` is null. */
export class SetPinChannel implements IpcChannel {
  name: ValidIpcChanel = 'roster:set-pin'

  async handle(request: IpcRequest): Promise<IpcResponse> {
    const vouching = getHostVouching()
    const personKey = personKeyOf(request)
    if (!vouching || !personKey) {
      return notRunning()
    }
    const { pin } = (request?.data ?? {}) as { pin?: unknown }
    try {
      const result = await vouching.setPin(personKey, pin)
      return result.ok
        ? { success: true }
        : { success: false, error: new Error(result.error) }
    } catch (error) {
      console.error('Could not set a PIN:', error)
      return { success: false, error: asError(error) }
    }
  }
}

/** Every vouch this host has signed, for the operator to look back over. */
export class GetSignedVouchesChannel implements IpcChannel {
  name: ValidIpcChanel = 'roster:get-vouches'

  async handle(): Promise<IpcResponse> {
    const vouching = getHostVouching()
    if (!vouching) {
      return notRunning()
    }
    try {
      return {
        success: true,
        data: { vouches: await vouching.signedVouches() },
      }
    } catch (error) {
      console.error('Could not read the signed vouches:', error)
      return { success: false, error: asError(error) }
    }
  }
}

/**
 * Withdraws a vouch the host signed. The revocation is listed on the
 * recordings named by the root document the renderer is showing.
 */
export class RevokeVouchChannel implements IpcChannel {
  name: ValidIpcChanel = 'roster:revoke-vouch'

  async handle(request: IpcRequest): Promise<IpcResponse> {
    const vouching = getHostVouching()
    const { address, docUrl } = (request?.data ?? {}) as {
      address?: unknown
      docUrl?: unknown
    }
    if (
      !vouching ||
      typeof address !== 'string' ||
      typeof docUrl !== 'string'
    ) {
      return notRunning()
    }
    try {
      const result = await vouching.revokeVouch(address, { docUrl })
      return result.ok
        ? { success: true, data: { listedOn: result.listedOn.length } }
        : { success: false, error: new Error(result.error) }
    } catch (error) {
      console.error('Could not revoke a vouch:', error)
      return { success: false, error: asError(error) }
    }
  }
}
