import { keyFingerprint } from '@tapes-monorepo/provenance'
import { sanitizeLabel } from '@tapes-monorepo/sync-protocol'
import { asError } from '@/asError'
import { trustedHostsPath } from '@/syncServerConfig'
import { createTrustedHosts, type TrustedHosts } from '@/trustedHosts'
import {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * The operator's trust in another host's key, in the host's own window. A
 * vouch from a trusted key counts as the person's own signature in the
 * Library. These run over IPC only, so nothing on the LAN can grant itself
 * trust.
 *
 * The store is independent of the sync server, so the operator can change the
 * list whether or not this host is serving the LAN.
 */

let store: TrustedHosts | undefined

const hosts = () => (store ??= createTrustedHosts(trustedHostsPath()))

/** For tests, which have no Electron `app` to give a userData path. */
export function setTrustedHostsForTesting(testStore: TrustedHosts | undefined) {
  store = testStore
}

/**
 * The key as a valid Ed25519 public key, or undefined. A fingerprint is only
 * defined for a 32-byte key, so it doubles as the check.
 */
async function hostKeyOf(request: IpcRequest): Promise<string | undefined> {
  const { hostKey } = (request?.data ?? {}) as { hostKey?: unknown }
  if (typeof hostKey !== 'string') {
    return undefined
  }
  return (await keyFingerprint(hostKey)) ? hostKey : undefined
}

const notAKey = (): IpcResponse => ({
  success: false,
  error: new Error('That is not a host key'),
})

/** The trusted keys, newest last, as the store holds them. */
export class GetTrustedHostsChannel implements IpcChannel {
  name: ValidIpcChanel = 'trust:get-hosts'

  async handle(): Promise<IpcResponse> {
    try {
      return { success: true, data: { hosts: await hosts().list() } }
    } catch (error) {
      console.error('Could not read the trusted hosts:', error)
      return { success: false, error: asError(error) }
    }
  }
}

/**
 * Trusts a host key. `hostLabel` is the name from the vouch the operator
 * trusted it from, and is absent for a key they typed in.
 */
export class AddTrustedHostChannel implements IpcChannel {
  name: ValidIpcChanel = 'trust:add-host'

  async handle(request: IpcRequest): Promise<IpcResponse> {
    const hostKey = await hostKeyOf(request)
    if (!hostKey) {
      return notAKey()
    }
    const { hostLabel } = (request?.data ?? {}) as { hostLabel?: unknown }
    // The label came from a statement signed by another host, so it is
    // untrusted text, like any device label.
    const label = sanitizeLabel(hostLabel)
    try {
      await hosts().add({
        hostKey,
        ...(label && { hostLabel: label }),
        addedAt: new Date().toISOString(),
      })
      return { success: true }
    } catch (error) {
      console.error('Could not trust a host:', error)
      return { success: false, error: asError(error) }
    }
  }
}

export class RemoveTrustedHostChannel implements IpcChannel {
  name: ValidIpcChanel = 'trust:remove-host'

  async handle(request: IpcRequest): Promise<IpcResponse> {
    const hostKey = await hostKeyOf(request)
    if (!hostKey) {
      return notAKey()
    }
    try {
      return (await hosts().remove(hostKey))
        ? { success: true }
        : {
            success: false,
            error: new Error('That host key is not trusted'),
          }
    } catch (error) {
      console.error('Could not stop trusting a host:', error)
      return { success: false, error: asError(error) }
    }
  }
}
