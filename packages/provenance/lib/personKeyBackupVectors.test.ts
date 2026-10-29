import { afterEach, describe, expect, it, vi } from 'vitest'
import { toBase64Url } from './encoding'
import {
  backupToText,
  decodeBackup,
  encodeBackup,
  personKeyServiceToken,
  unwrapPersonKey,
  unwrapPersonKeyWithPasskey,
  wrapPersonKey,
  wrapPersonKeyWithPasskey,
  type DeriveBackupKey,
} from './personKeyBackup'

/**
 * Fixed records for both unlock methods, so another implementation of Person
 * key wrapping format v1 can check itself byte for byte. Every input here is
 * a constant: the seed, the salt, the nonce, the passphrase and the PRF
 * output. Nothing is generated, so the records never change.
 *
 * The method 1 vector uses the test KDF below rather than Argon2id, because
 * this package takes its KDF from the caller. It pins the byte layout, not
 * the Argon2id output. The method 2 vector is complete: HKDF-SHA-256 and
 * AES-256-GCM are both WebCrypto, so the record is reproducible anywhere.
 */

/** The fixed PKCS #8 prefix for an Ed25519 private key (RFC 8410). */
const PKCS8_PREFIX = '302e020100300506032b657004220420'

const SEED = '0101020305080d1522375990e97962db3d18556dc22ff1106177d8e7bf96af45'
/** The Ed25519 public key that seed produces. */
const PUBLIC_KEY =
  '6b3ccc2d23b163697cd6114508834cc298106708edc4fbff77fa92c98dcdd7ca'

const SALT = '000102030405060708090a0b0c0d0e0f'
const NONCE = '101112131415161718191a1b'

const PASSPHRASE = 'correct horse battery staple'

/** 32 bytes standing in for what `prf.eval.first` returns. */
const PRF = 'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf'
const RP_ID = 'tapes.network'
/** SHA-256 of `tapes.network`, which the header carries. */
const RP_ID_HASH =
  'cb1bf8b80898e0031952ef0fb511f5a7d738b0b4d54ad9241c149fbfdad91df3'
/** 20 bytes standing in for a credential id. */
const CREDENTIAL_ID = '2a2b2c2d2e2f303132333435363738393a3b3c3d'
const CREDENTIAL_ID_TEXT = 'KissLS4vMDEyMzQ1Njc4OTo7PD0'

/**
 * Method 1, with the test KDF. Version 1, method 1, 64 MiB, 3 passes, one
 * lane, then the salt, nonce, public key and ciphertext.
 */
const PASSPHRASE_RECORD =
  '0101' +
  '00010000' +
  '03' +
  '01' +
  SALT +
  NONCE +
  PUBLIC_KEY +
  '1de6b32062cef0b1485e69ed33e451288832c87ee2d823e7eb5e033845614d83' +
  '1e9c07578f1db02eab6829394941bbcf'

/**
 * Method 2. Version 1, method 2, the relying party hash, the credential id
 * length and bytes, then the salt, nonce, public key and ciphertext.
 */
const PASSKEY_RECORD =
  '0102' +
  RP_ID_HASH +
  '0014' +
  CREDENTIAL_ID +
  SALT +
  NONCE +
  PUBLIC_KEY +
  '5ee6c82829489fd7d3af0b77c5c4208760f3a2126ca3aa6f550724e5d6c01927' +
  '1d6a6184ff0a2a3c70f38a018b08f5d9'

const PASSKEY_TEXT =
  'TPK1.AQLLG_i4CJjgAxlS7w-1EfWn1ziwtNVK2SQcFJ-_2tkd8wAUKissLS4vMDEy' +
  'MzQ1Njc4OTo7PD0AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobazzMLSOxY2l8' +
  '1hFFCINMwpgQZwjtxPv_d_qSyY3N18pe5sgoKUif19OvC3fFxCCHYPOiEmyjqm9V' +
  'ByTl1sAZJx1qYYT_Cio8cPOKAYsI9dk'

/** HKDF over the PRF output with an empty salt and the service-auth info. */
const SERVICE_TOKEN = 'BNj-GG3wFSiznnmx-TIfCVMWrTRizZI3jT4zXkzATT0'

/**
 * Stands in for Argon2id, which lives in the web client. PBKDF2-SHA-256 over
 * 1000 iterations, so the method 1 vector is cheap and reproducible.
 */
const derive: DeriveBackupKey = async (passphrase, salt) => {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 },
      base,
      256,
    ),
  )
}

function bytes(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/../g) ?? []
  return Uint8Array.from(pairs.map((pair) => parseInt(pair, 16)))
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** The person key the vectors wrap, from its seed. */
async function personKeyFromSeed(): Promise<CryptoKeyPair> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    bytes(PKCS8_PREFIX + SEED),
    { name: 'Ed25519' },
    true,
    ['sign'],
  )
  const { x } = await crypto.subtle.exportKey('jwk', privateKey)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x },
    { name: 'Ed25519' },
    true,
    ['verify'],
  )
  return { privateKey, publicKey }
}

/** Wrapping draws the salt first and then the nonce. */
function fixedRandomBytes(...values: string[]) {
  let next = 0
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView | null>(array: T): T => {
      const target = array as unknown as Uint8Array
      target.set(bytes(values[next++]).subarray(0, target.length))
      return array
    },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('method 1 vector', () => {
  it('wraps the seed into the recorded bytes', async () => {
    fixedRandomBytes(SALT, NONCE)
    const backup = await wrapPersonKey(
      await personKeyFromSeed(),
      PASSPHRASE,
      derive,
    )
    expect(hex(encodeBackup(backup))).toBe(PASSPHRASE_RECORD)
    expect(encodeBackup(backup)).toHaveLength(116)
  })

  it('unwraps the recorded bytes back to the person key', async () => {
    const parsed = decodeBackup(bytes(PASSPHRASE_RECORD))
    if (!parsed.ok) throw new Error(parsed.problem)

    expect(parsed.backup.unlock).toEqual({
      method: 1,
      kdf: { kdf: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
    })
    const unwrapped = await unwrapPersonKey(parsed.backup, PASSPHRASE, derive)
    if (!unwrapped.ok) throw new Error(unwrapped.problem)
    expect(unwrapped.publicKey).toBe(toBase64Url(bytes(PUBLIC_KEY)))
  })
})

describe('method 2 vector', () => {
  it('wraps the seed into the recorded bytes', async () => {
    fixedRandomBytes(SALT, NONCE)
    const backup = await wrapPersonKeyWithPasskey(await personKeyFromSeed(), {
      prf: bytes(PRF),
      rpId: RP_ID,
      credentialId: CREDENTIAL_ID_TEXT,
    })
    expect(hex(encodeBackup(backup))).toBe(PASSKEY_RECORD)
    // 144 bytes plus the 20-byte credential id.
    expect(encodeBackup(backup)).toHaveLength(164)
    expect(backupToText(backup)).toBe(PASSKEY_TEXT)
  })

  it('hashes the relying party id into the header', () => {
    expect(toBase64Url(bytes(CREDENTIAL_ID))).toBe(CREDENTIAL_ID_TEXT)
    const parsed = decodeBackup(bytes(PASSKEY_RECORD))
    if (!parsed.ok) throw new Error(parsed.problem)
    if (parsed.backup.unlock.method !== 2) throw new Error('not method 2')

    expect(hex(parsed.backup.unlock.rpIdHash)).toBe(RP_ID_HASH)
    expect(hex(parsed.backup.unlock.credentialId)).toBe(CREDENTIAL_ID)
  })

  it('unwraps the recorded bytes back to the person key', async () => {
    const parsed = decodeBackup(bytes(PASSKEY_RECORD))
    if (!parsed.ok) throw new Error(parsed.problem)

    const unwrapped = await unwrapPersonKeyWithPasskey(
      parsed.backup,
      bytes(PRF),
    )
    if (!unwrapped.ok) throw new Error(unwrapped.problem)
    expect(unwrapped.publicKey).toBe(toBase64Url(bytes(PUBLIC_KEY)))
  })

  it('derives the service auth token from the PRF output alone', async () => {
    expect(await personKeyServiceToken(bytes(PRF))).toBe(SERVICE_TOKEN)
  })
})
