/**
 * Ed25519 signing and verification of statements over WebCrypto, and the
 * content address of a signed statement.
 *
 * A signature covers the canonical JSON of the payload only. An address covers
 * the whole signed statement, signature included.
 */

import { canonicalJson } from './canonicalJson'
import { fromBase64Url, sha256Hex, toBase64Url } from './encoding'
import type { Signed } from './types'

const ED25519 = { name: 'Ed25519' }

const encoder = new TextEncoder()

/**
 * A new signing key pair. Keep `extractable` false unless the private key has
 * to leave WebCrypto, such as to be saved in the OS keychain.
 */
export async function generateSigningKeyPair(
  extractable = false,
): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(ED25519, extractable, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
}

/** The public key as it appears in statements: raw bytes in base64url. */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', publicKey)
  return toBase64Url(new Uint8Array(raw))
}

/** Returns undefined when the text is not a 32-byte base64url key. */
export async function importPublicKey(
  text: string,
): Promise<CryptoKey | undefined> {
  const raw = fromBase64Url(text)
  if (raw?.length !== 32) {
    return undefined
  }
  try {
    return await crypto.subtle.importKey('raw', raw, ED25519, true, ['verify'])
  } catch {
    return undefined
  }
}

export async function signStatement<T extends { type: string }>(
  payload: T,
  privateKey: CryptoKey,
): Promise<Signed<T>> {
  const signature = await crypto.subtle.sign(
    ED25519,
    privateKey,
    encoder.encode(canonicalJson(payload)),
  )
  return { payload, signature: toBase64Url(new Uint8Array(signature)) }
}

/**
 * Whether `publicKey` signed this payload. Malformed input returns false
 * rather than throwing, since statements arrive from other devices.
 *
 * The caller chooses the key. Checking against the key a payload names only
 * proves the statement is self-consistent, not who made it.
 */
export async function verifyStatement(
  signed: Signed<unknown>,
  publicKey: CryptoKey | string,
): Promise<boolean> {
  try {
    const key =
      typeof publicKey === 'string'
        ? await importPublicKey(publicKey)
        : publicKey
    const signature = fromBase64Url(signed.signature)
    if (!key || signature?.length !== 64) {
      return false
    }
    return await crypto.subtle.verify(
      ED25519,
      key,
      signature,
      encoder.encode(canonicalJson(signed.payload)),
    )
  } catch {
    return false
  }
}

/** The MIME type a signed statement is stored and served under. */
export const STATEMENT_MIME_TYPE = 'application/json'

/**
 * The bytes a signed statement is stored as: its canonical JSON. A store that
 * addresses objects by sha-256 files it under its `statementAddress`.
 */
export function statementBytes(
  signed: Signed<unknown>,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(canonicalJson(signed))
}

/**
 * The sha-256 of the signed statement's canonical JSON. This is where it is
 * stored in the host's blob store and how other statements refer to it.
 */
export async function statementAddress(
  signed: Signed<unknown>,
): Promise<string> {
  return sha256Hex(statementBytes(signed))
}
