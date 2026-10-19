// THROWAWAY PROTOTYPE (TAP-220). Not production code.
//
// Wraps and unwraps a person key with a secret from the WebAuthn PRF extension.
// Plain browser JavaScript with no build step. The Node tests import it too.
//
// The PRF output never leaves the device. Two keys are derived from it with
// HKDF: one encrypts the person key, the other proves ownership to the service.
// The service sees only the second one, so it cannot decrypt the blob.

const encoder = new TextEncoder()

/** The fixed PRF salt. The same salt on every device gives the same secret. */
export const PRF_SALT = encoder.encode('tapes/person-key-backup/v1')

/** Bumped if the wrapping format changes. Bound into the AES-GCM tag. */
export const BLOB_VERSION = 1

export function toBase64Url(bytes) {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromBase64Url(text) {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function hkdf(prfOutput, info, usages, algorithm) {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, [
    'deriveKey',
    'deriveBits',
  ])
  const params = {
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: encoder.encode(info),
  }
  if (algorithm) {
    return crypto.subtle.deriveKey(params, base, algorithm, false, usages)
  }
  return new Uint8Array(await crypto.subtle.deriveBits(params, base, 256))
}

/**
 * Splits a 32-byte PRF output into a wrapping key and an auth token.
 * The auth token is sent to the service. The wrapping key never is.
 */
export async function deriveKeys(prfOutput) {
  const wrapKey = await hkdf(prfOutput, 'tapes/wrap', ['encrypt', 'decrypt'], {
    name: 'AES-GCM',
    length: 256,
  })
  const authToken = toBase64Url(await hkdf(prfOutput, 'tapes/auth'))
  return { wrapKey, authToken }
}

function additionalData(credentialId) {
  // Binds the blob to one passkey, so a blob cannot be swapped between records.
  return encoder.encode(`tapes/v${BLOB_VERSION}/${credentialId}`)
}

/** Encrypts the person key's PKCS#8 bytes. Returns a JSON-safe blob. */
export async function wrapPersonKey(wrapKey, credentialId, pkcs8) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(credentialId) },
    wrapKey,
    pkcs8,
  )
  return {
    v: BLOB_VERSION,
    alg: 'A256GCM',
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ciphertext)),
  }
}

/** Decrypts a blob back to PKCS#8 bytes. Throws if the key or blob is wrong. */
export async function unwrapPersonKey(wrapKey, credentialId, blob) {
  if (blob.v !== BLOB_VERSION) throw new Error(`Unknown blob version ${blob.v}`)
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(blob.iv),
      additionalData: additionalData(credentialId),
    },
    wrapKey,
    fromBase64Url(blob.ct),
  )
  return new Uint8Array(plain)
}

/** A short label for a public key, in the same format as provenance uses. */
export async function fingerprint(rawPublicKey) {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', rawPublicKey),
  )
  const hex = Array.from(hash.slice(0, 6), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`
}
