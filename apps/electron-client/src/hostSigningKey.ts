import path from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { app, safeStorage } from 'electron'
import { generateSigningKeyPair } from '@tapes-monorepo/provenance'

/**
 * The host's Ed25519 key for signing provenance statements. It is generated on
 * first launch and kept for the life of the install. The private key is stored
 * encrypted by Electron's safeStorage, whose encryption key lives in the macOS
 * Keychain, so the file on disk is useless without the keychain.
 *
 * This is not the TLS root CA key in `certManager`. Each key lives in its own
 * directory, so a leak of one does not expose the other.
 */

const ED25519 = { name: 'Ed25519' }

const keyDir = () => path.join(app.getPath('userData'), 'provenance')
const keyPath = () => path.join(keyDir(), 'signing-key.bin')

type Ed25519PrivateJwk = JsonWebKey & { d: string; x: string }

function isEd25519PrivateJwk(value: unknown): value is Ed25519PrivateJwk {
  const jwk = value as Partial<Ed25519PrivateJwk> | null
  return (
    jwk?.kty === 'OKP' &&
    jwk.crv === 'Ed25519' &&
    typeof jwk.d === 'string' &&
    typeof jwk.x === 'string'
  )
}

// The private half is imported non-extractable. Once loaded, nothing in this
// process can read the key bytes back out.
async function importKeyPair(jwk: Ed25519PrivateJwk): Promise<CryptoKeyPair> {
  const { kty, crv, x } = jwk
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey('jwk', jwk, ED25519, false, ['sign']),
    crypto.subtle.importKey('jwk', { kty, crv, x }, ED25519, true, ['verify']),
  ])
  return { privateKey, publicKey }
}

async function readKeyPair(): Promise<CryptoKeyPair> {
  let jwk: unknown
  try {
    jwk = JSON.parse(safeStorage.decryptString(readFileSync(keyPath())))
  } catch (error) {
    // Replacing the key here would quietly give the host a new identity, so
    // leave the file for someone to look at.
    throw new Error(`Could not decrypt the host signing key at ${keyPath()}`, {
      cause: error,
    })
  }
  if (!isEd25519PrivateJwk(jwk)) {
    throw new Error(`The host signing key at ${keyPath()} is not Ed25519`)
  }
  return importKeyPair(jwk)
}

async function createKeyPair(): Promise<CryptoKeyPair> {
  // Without the keychain the key would sit on disk in plain text.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Cannot store a host signing key: safeStorage unavailable')
  }

  // Extractable only for as long as it takes to encrypt it.
  const generated = await generateSigningKeyPair(true)
  const jwk = await crypto.subtle.exportKey('jwk', generated.privateKey)
  if (!isEd25519PrivateJwk(jwk)) {
    throw new Error('WebCrypto exported an unexpected Ed25519 key')
  }

  mkdirSync(keyDir(), { recursive: true })
  // Write then rename, so a crash cannot leave a half-written key behind.
  const tempPath = `${keyPath()}.tmp`
  writeFileSync(tempPath, safeStorage.encryptString(JSON.stringify(jwk)), {
    mode: 0o600,
  })
  renameSync(tempPath, keyPath())

  return importKeyPair(jwk)
}

let pending: Promise<CryptoKeyPair> | undefined

/**
 * The host's signing key pair, created on the first call of an install. Must
 * be called after the app is ready, since safeStorage needs that. A failed
 * load is not cached, so a later call tries again.
 */
export function loadHostSigningKey(): Promise<CryptoKeyPair> {
  pending ??= (existsSync(keyPath()) ? readKeyPair() : createKeyPair()).catch(
    (error: unknown) => {
      pending = undefined
      throw error
    },
  )
  return pending
}
