import { asError } from '@/asError'
import { getHostVouching } from '@/syncServer'
import {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * The operator's PIN controls, in the host's own window. The operator checks
 * who is asking in person, then unlocks their PIN or sets a new one. These run
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
