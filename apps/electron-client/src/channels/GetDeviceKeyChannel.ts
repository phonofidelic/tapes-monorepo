import { asError } from '@/asError'
import { loadHostSigningKey } from '@/hostSigningKey'
import { exportPublicKey } from '@tapes-monorepo/provenance'
import {
  DeviceKeyResponse,
  IpcChannel,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * The public key this desktop signs its recording claims with. The Library
 * uses it to say "this device" for recordings made here.
 *
 * The desktop signs its claims with the host key, so that is the key returned.
 */
export class GetDeviceKeyChannel implements IpcChannel {
  name: ValidIpcChanel = 'provenance:get-device-key'

  constructor(
    private loadSigningKey: () => Promise<CryptoKeyPair> = loadHostSigningKey,
  ) {}

  async handle(): Promise<DeviceKeyResponse> {
    try {
      const keyPair = await this.loadSigningKey()
      return {
        success: true,
        data: { publicKey: await exportPublicKey(keyPair.publicKey) },
      }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}
