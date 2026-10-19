/**
 * THROWAWAY (TAP-218). Turns a passphrase into a 32-byte AES-GCM key with
 * either PBKDF2-SHA256 (WebCrypto, no extra code) or Argon2id (hash-wasm,
 * about 11 kB gzipped of WebAssembly). Both are here so they can be compared
 * on a real phone. The parameters below are the proposal, not a decision.
 */

import { argon2id } from 'hash-wasm'

export type Pbkdf2Params = { kdf: 'pbkdf2-sha256'; iterations: number }

export type Argon2idParams = {
  kdf: 'argon2id'
  /** Memory in KiB, as RFC 9106 and hash-wasm count it. */
  memoryKiB: number
  iterations: number
  parallelism: number
}

export type KdfParams = Pbkdf2Params | Argon2idParams

// OWASP's current floor for PBKDF2-HMAC-SHA256. A backup file can be attacked
// offline forever, so treat this as the minimum, not a target.
export const PROPOSED_PBKDF2: Pbkdf2Params = {
  kdf: 'pbkdf2-sha256',
  iterations: 600_000,
}

// RFC 9106's second recommended option is 64 MiB and three passes. hash-wasm
// runs single-threaded, so parallelism 1 costs the phone nothing extra.
export const PROPOSED_ARGON2ID: Argon2idParams = {
  kdf: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
}

const encoder = new TextEncoder()

/** The raw 32 bytes the KDF produces. Exposed for the benchmark page. */
export async function deriveBytes(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  const password = encoder.encode(passphrase)
  if (params.kdf === 'pbkdf2-sha256') {
    const base = await crypto.subtle.importKey(
      'raw',
      password,
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: params.iterations },
      base,
      256,
    )
    return new Uint8Array(bits)
  }
  const out = await argon2id({
    password,
    salt,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  })
  return new Uint8Array(out)
}

export function describeKdf(params: KdfParams): string {
  if (params.kdf === 'pbkdf2-sha256') {
    return `PBKDF2-SHA256, ${params.iterations.toLocaleString('en')} iterations`
  }
  return `Argon2id, ${params.memoryKiB / 1024} MiB, t=${params.iterations}, p=${params.parallelism}`
}
