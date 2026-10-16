import type { AppContextValue } from '@/context/AppContext'
import type { DeviceKeyResponse } from '@/IpcService'
import { callWorker } from '@/workerClient'

/**
 * The public key this device signs its recording claims with, read from the
 * platform backend. The Library compares it to a claim's device key to say
 * "this device".
 *
 * Resolves undefined when the backend has no key, such as a browser without
 * Ed25519. The Library then shows a fingerprint instead.
 */

const keys = new WeakMap<AppContextValue, Promise<string | undefined>>()

async function requestKey(
  appContext: AppContextValue,
): Promise<string | undefined> {
  try {
    if (appContext.type === 'web-client') {
      const { publicKey } = await callWorker<{ publicKey: string }>(
        appContext.worker,
        'provenance:device-key',
      )
      return publicKey
    }
    const response = await appContext.ipc.send<DeviceKeyResponse>(
      'provenance:get-device-key',
    )
    return response.success ? response.data.publicKey : undefined
  } catch (error) {
    console.error('Could not read this device signing key:', error)
    return undefined
  }
}

/** Asks the backend once per app context. The key does not change. */
export function readLocalDeviceKey(
  appContext: AppContextValue,
): Promise<string | undefined> {
  let pending = keys.get(appContext)
  if (!pending) {
    pending = requestKey(appContext)
    keys.set(appContext, pending)
  }
  return pending
}
