/**
 * THROWAWAY (TAP-218). Wraps an Ed25519 person key with a passphrase and
 * unwraps it again. The 32-byte seed is what gets encrypted. WebCrypto only
 * exports and imports Ed25519 private keys as PKCS #8, so this file converts
 * between the two. A person key must be generated extractable to be backed up.
 */

import { exportPublicKey } from '@tapes-monorepo/provenance'
import {
  encodeHeader,
  FORMAT_VERSION,
  NONCE_LENGTH,
  SALT_LENGTH,
  type Backup,
} from './format'
import { deriveBytes, type KdfParams } from './kdf'
import { normalizePassphrase } from './passphrase'

// The fixed PKCS #8 prefix for an Ed25519 private key (RFC 8410).
const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
])

export type PersonKey = {
  privateKey: CryptoKey
  publicKey: CryptoKey
  /** Raw public key in base64url, as provenance statements carry it. */
  publicKeyText: string
}

export async function generatePersonKey(): Promise<PersonKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyText: await exportPublicKey(pair.publicKey),
  }
}

export async function exportSeed(
  privateKey: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', privateKey),
  )
  return pkcs8.slice(pkcs8.length - 32)
}

/** Imports a seed. Only the private key comes back extractable. */
export async function importSeed(
  seed: Uint8Array<ArrayBuffer>,
  extractable = false,
): Promise<CryptoKey> {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32)
  pkcs8.set(PKCS8_PREFIX)
  pkcs8.set(seed, PKCS8_PREFIX.length)
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    extractable,
    ['sign'],
  )
}

/** Lets the browser pages run the KDF in a worker. Tests use the default. */
export type Derive = typeof deriveBytes

async function wrappingKey(
  derive: Derive,
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  kdf: KdfParams,
): Promise<CryptoKey> {
  const bytes = await derive(normalizePassphrase(passphrase), salt, kdf)
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
  bytes.fill(0)
  return key
}

export async function wrapPersonKey(
  key: PersonKey,
  passphrase: string,
  kdf: KdfParams,
  derive: Derive = deriveBytes,
): Promise<Backup> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH))
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', key.publicKey),
  )
  const header = { version: FORMAT_VERSION, kdf, salt, nonce, publicKey }
  const aesKey = await wrappingKey(derive, passphrase, salt, kdf)
  const seed = await exportSeed(key.privateKey)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: encodeHeader(header) },
    aesKey,
    seed,
  )
  seed.fill(0)
  return { ...header, ciphertext: new Uint8Array(ciphertext) }
}

export type UnwrapResult =
  | { ok: true; key: PersonKey }
  | { ok: false; error: 'wrong-passphrase' | 'key-mismatch' }

/**
 * A wrong passphrase and a damaged backup look the same to AES-GCM. Both
 * come back as wrong-passphrase, which is what a person should check first.
 */
export async function unwrapPersonKey(
  backup: Backup,
  passphrase: string,
  derive: Derive = deriveBytes,
): Promise<UnwrapResult> {
  const aesKey = await wrappingKey(derive, passphrase, backup.salt, backup.kdf)
  let seed: Uint8Array<ArrayBuffer>
  try {
    seed = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: backup.nonce,
          additionalData: encodeHeader(backup),
        },
        aesKey,
        backup.ciphertext,
      ),
    )
  } catch {
    return { ok: false, error: 'wrong-passphrase' }
  }

  // Import extractable once to read the public key back out of the JWK, and
  // check it is the one the backup says it is.
  const extractable = await importSeed(seed, true)
  const jwk = await crypto.subtle.exportKey('jwk', extractable)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
    { name: 'Ed25519' },
    true,
    ['verify'],
  )
  const publicKeyText = await exportPublicKey(publicKey)
  const expected = await exportPublicKey(
    await crypto.subtle.importKey(
      'raw',
      backup.publicKey,
      { name: 'Ed25519' },
      true,
      ['verify'],
    ),
  )
  if (publicKeyText !== expected) {
    seed.fill(0)
    return { ok: false, error: 'key-mismatch' }
  }
  // Kept extractable so the restored device can make a new backup later.
  const privateKey = await importSeed(seed, true)
  seed.fill(0)
  return { ok: true, key: { privateKey, publicKey, publicKeyText } }
}
