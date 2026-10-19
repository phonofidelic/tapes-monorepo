/**
 * THROWAWAY (TAP-218). Runs key derivation off the main thread, so the page
 * stays responsive for the one to three seconds it takes on a phone. The
 * benchmark uses it too, so its timings match what the real flow would feel.
 */

import { deriveBytes, type KdfParams } from './kdf'

export type KdfRequest = {
  id: number
  passphrase: string
  salt: Uint8Array<ArrayBuffer>
  params: KdfParams
}

export type KdfResponse =
  | { id: number; ok: true; bytes: Uint8Array<ArrayBuffer>; ms: number }
  | { id: number; ok: false; error: string }

self.onmessage = async (event: MessageEvent<KdfRequest>) => {
  const { id, passphrase, salt, params } = event.data
  try {
    const start = performance.now()
    const bytes = await deriveBytes(passphrase, salt, params)
    const ms = performance.now() - start
    ;(self as unknown as Worker).postMessage({
      id,
      ok: true,
      bytes,
      ms,
    } satisfies KdfResponse)
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: String(error),
    } satisfies KdfResponse)
  }
}
