/**
 * A wrapped copy of a person key, format version 1. One binary record: the
 * version, the unlock method and its parameters, a salt, a nonce, the public
 * key, and the AES-256-GCM encrypted 32-byte seed. It travels as `TPK1.` plus
 * base64url, in a QR code, a saved file, or a record a host holds.
 *
 * Method 1 unlocks with a passphrase, method 2 with a passkey's PRF output.
 * Never change the layout of either: records live in people's files for years.
 * The passphrase KDF is passed in, so this package stays free of WebAssembly.
 */

import { fromBase64Url, toBase64Url } from './encoding'
import { exportPublicKey } from './signing'

export const BACKUP_FORMAT_VERSION = 1

/** Prefix of the text form. The digit is the format version. */
export const BACKUP_TEXT_PREFIX = 'TPK1.'

/** The `format` field of the file form. */
export const BACKUP_FILE_FORMAT = 'tapes-person-key-backup'

/**
 * Which secret unlocks a record. A new method takes a new byte here rather
 * than a new format version.
 */
export const UNLOCK_PASSPHRASE = 1
export const UNLOCK_PASSKEY = 2

/**
 * The one PRF salt, for every passkey, device and record, so that one passkey
 * always yields one secret. It goes in `prf.eval.first`, and `second` is never
 * used. `apps/identity/public/ceremony.v1.js` holds its own copy of this
 * string, because it cannot import one.
 */
export const PERSON_KEY_PRF_SALT = 'tapes/person-key/v1'

/** WebAuthn's own cap on a credential id. */
export const MAX_CREDENTIAL_ID_LENGTH = 1023

export type Argon2idParams = {
  kdf: 'argon2id'
  /** Memory in KiB, as RFC 9106 counts it. */
  memoryKiB: number
  iterations: number
  parallelism: number
}

/**
 * RFC 9106's second recommended option. A backup file can be attacked offline
 * forever, so it is set as high as a mid-range phone allows.
 */
export const BACKUP_KDF: Argon2idParams = {
  kdf: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
}

/** Turns a normalized passphrase into the 32-byte AES-GCM key. */
export type DeriveBackupKey = (
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: Argon2idParams,
) => Promise<Uint8Array<ArrayBuffer>>

/** Method 1: the passphrase goes through Argon2id with these settings. */
export type PassphraseUnlock = {
  method: typeof UNLOCK_PASSPHRASE
  kdf: Argon2idParams
}

/**
 * Method 2: a passkey's PRF output unlocks the record. Both fields sit in the
 * header, which is the cipher's additional data, so a record only opens for
 * the passkey that made it and only under the domain it was made at.
 */
export type PasskeyUnlock = {
  method: typeof UNLOCK_PASSKEY
  /** SHA-256 of the relying party id, as UTF-8 bytes. */
  rpIdHash: Uint8Array<ArrayBuffer>
  credentialId: Uint8Array<ArrayBuffer>
}

export type UnlockMethod = PassphraseUnlock | PasskeyUnlock

/** What a passkey ceremony returns, as the record needs it. */
export type PasskeySecret = {
  /** The 32 bytes `prf.eval.first` produced. Never stored as it is. */
  prf: Uint8Array<ArrayBuffer>
  /** The relying party id the passkey is bound to. */
  rpId: string
  /** The credential id, base64url, as WebAuthn spells it. */
  credentialId: string
}

const RP_ID_HASH_LENGTH = 32
const SALT_LENGTH = 16
const NONCE_LENGTH = 12
const PUBLIC_KEY_LENGTH = 32
/** A 32-byte Ed25519 seed plus the 16-byte AES-GCM tag. */
const CIPHERTEXT_LENGTH = 48

/** Everything after the method parameters is the same in every record. */
const FIXED_LENGTH =
  SALT_LENGTH + NONCE_LENGTH + PUBLIC_KEY_LENGTH + CIPHERTEXT_LENGTH
const PASSPHRASE_RECORD_LENGTH = 2 + 6 + FIXED_LENGTH
const passkeyRecordLength = (credentialIdLength: number) =>
  2 + RP_ID_HASH_LENGTH + 2 + credentialIdLength + FIXED_LENGTH

/** HKDF info strings. The PRF output is never used as a key directly. */
const WRAP_INFO = 'tapes/person-key/v1/wrap'
const SERVICE_AUTH_INFO = 'tapes/person-key/v1/service-auth'

export type PersonKeyBackup = {
  version: number
  unlock: UnlockMethod
  salt: Uint8Array<ArrayBuffer>
  nonce: Uint8Array<ArrayBuffer>
  /** In the clear, so a restore can show whose key it is first. */
  publicKey: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

/** Why some text is not a record this version can open. */
export type BackupProblem =
  | 'not-a-backup'
  | 'newer-version'
  | 'damaged'
  /** The unlock method, or its settings, are not ones this reader supports. */
  | 'unsupported-method'

export type BackupParse =
  { ok: true; backup: PersonKeyBackup } | { ok: false; problem: BackupProblem }

/**
 * Everything except the ciphertext. It is also the AES-GCM additional data, so
 * changing the method, its parameters or the public key makes unlocking fail.
 */
function encodeHeader(
  backup: Omit<PersonKeyBackup, 'ciphertext'>,
): Uint8Array<ArrayBuffer> {
  const { unlock } = backup
  const params =
    unlock.method === UNLOCK_PASSPHRASE
      ? [
          ...u32(unlock.kdf.memoryKiB),
          unlock.kdf.iterations & 0xff,
          unlock.kdf.parallelism & 0xff,
        ]
      : [
          ...unlock.rpIdHash,
          ...u16(unlock.credentialId.length),
          ...unlock.credentialId,
        ]
  return Uint8Array.from([
    backup.version,
    unlock.method,
    ...params,
    ...backup.salt,
    ...backup.nonce,
    ...backup.publicKey,
  ])
}

export function encodeBackup(backup: PersonKeyBackup): Uint8Array<ArrayBuffer> {
  const header = encodeHeader(backup)
  const out = new Uint8Array(header.length + backup.ciphertext.length)
  out.set(header)
  out.set(backup.ciphertext, header.length)
  return out
}

/** Never throws. The bytes come from a camera, a file picker or a response. */
export function decodeBackup(bytes: Uint8Array): BackupParse {
  if (bytes.length < 2) {
    return { ok: false, problem: 'damaged' }
  }
  if (bytes[0] !== BACKUP_FORMAT_VERSION) {
    return { ok: false, problem: 'newer-version' }
  }
  let offset = 2
  const take = (n: number) => {
    const slice = new Uint8Array(bytes.subarray(offset, offset + n))
    offset += n
    return slice
  }

  // The method is read before any length, so a record this reader cannot open
  // says so instead of looking damaged.
  const method = bytes[1]
  let unlock: UnlockMethod
  if (method === UNLOCK_PASSPHRASE) {
    if (bytes.length !== PASSPHRASE_RECORD_LENGTH) {
      return { ok: false, problem: 'damaged' }
    }
    const memoryKiB = readU32(take(4))
    const [iterations, parallelism] = take(2)
    // Refuse sizes a phone cannot allocate rather than crash the tab. Tiny
    // ones mean a broken or hostile file.
    if (
      memoryKiB < 8 * 1024 ||
      memoryKiB > 1024 * 1024 ||
      iterations < 1 ||
      parallelism < 1
    ) {
      return { ok: false, problem: 'unsupported-method' }
    }
    unlock = {
      method: UNLOCK_PASSPHRASE,
      kdf: { kdf: 'argon2id', memoryKiB, iterations, parallelism },
    }
  } else if (method === UNLOCK_PASSKEY) {
    // The credential id says its own length, so the total is only known after
    // reading the fields before it.
    if (bytes.length < 2 + RP_ID_HASH_LENGTH + 2) {
      return { ok: false, problem: 'damaged' }
    }
    const rpIdHash = take(RP_ID_HASH_LENGTH)
    const credentialIdLength = readU16(take(2))
    if (
      credentialIdLength < 1 ||
      credentialIdLength > MAX_CREDENTIAL_ID_LENGTH ||
      bytes.length !== passkeyRecordLength(credentialIdLength)
    ) {
      return { ok: false, problem: 'damaged' }
    }
    unlock = {
      method: UNLOCK_PASSKEY,
      rpIdHash,
      credentialId: take(credentialIdLength),
    }
  } else {
    return { ok: false, problem: 'unsupported-method' }
  }

  return {
    ok: true,
    backup: {
      version: BACKUP_FORMAT_VERSION,
      unlock,
      salt: take(SALT_LENGTH),
      nonce: take(NONCE_LENGTH),
      publicKey: take(PUBLIC_KEY_LENGTH),
      ciphertext: take(CIPHERTEXT_LENGTH),
    },
  }
}

/** The text form, used as the QR payload and inside the file. */
export function backupToText(backup: PersonKeyBackup): string {
  return BACKUP_TEXT_PREFIX + toBase64Url(encodeBackup(backup))
}

/**
 * The credential id a passkey record is stored under, base64url. Undefined for
 * a passphrase record, which no store holds.
 */
export function passkeyRecordKey(backup: PersonKeyBackup): string | undefined {
  return backup.unlock.method === UNLOCK_PASSKEY
    ? toBase64Url(backup.unlock.credentialId)
    : undefined
}

/**
 * The file form: a small JSON object around the text form, so there is one
 * layout to version. It is saved as `.txt`, because Chrome's Web Share refuses
 * `.json` files. A store keyed by credential id holds the same object.
 */
export function backupToFileText(
  backup: PersonKeyBackup,
  createdAt = new Date(),
): string {
  const help =
    backup.unlock.method === UNLOCK_PASSKEY
      ? 'Tapes person key record. To restore it, open Tapes and pick this file. You also need the passkey that made it.'
      : 'Tapes person key backup. To restore it, open Tapes and pick this file. You also need your passphrase.'
  return (
    JSON.stringify(
      {
        format: BACKUP_FILE_FORMAT,
        version: BACKUP_FORMAT_VERSION,
        createdAt: createdAt.toISOString(),
        publicKey: toBase64Url(backup.publicKey),
        backup: backupToText(backup),
        help,
      },
      null,
      2,
    ) + '\n'
  )
}

/** Accepts the text form or the file's JSON, with stray whitespace. */
export function parseBackupText(text: string): BackupParse {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) {
    return parseCompact(trimmed)
  }
  try {
    const json = JSON.parse(trimmed) as { format?: unknown; backup?: unknown }
    if (json?.format !== BACKUP_FILE_FORMAT) {
      return { ok: false, problem: 'not-a-backup' }
    }
    return typeof json.backup === 'string'
      ? parseCompact(json.backup.trim())
      : { ok: false, problem: 'damaged' }
  } catch {
    return { ok: false, problem: 'not-a-backup' }
  }
}

function parseCompact(text: string): BackupParse {
  if (!text.startsWith('TPK')) {
    return { ok: false, problem: 'not-a-backup' }
  }
  if (!text.startsWith(BACKUP_TEXT_PREFIX)) {
    return { ok: false, problem: 'newer-version' }
  }
  const bytes = fromBase64Url(text.slice(BACKUP_TEXT_PREFIX.length))
  return bytes ? decodeBackup(bytes) : { ok: false, problem: 'damaged' }
}

/**
 * Applied before every derivation. Phone keyboards capitalize the first word
 * and add double spaces, and people type dots or commas between words. None
 * of that should lock someone out. Hyphens are kept for EFF words like t-shirt.
 */
export function normalizePassphrase(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s.,_]+/g, ' ')
    .trim()
}

// The fixed PKCS #8 prefix for an Ed25519 private key (RFC 8410). WebCrypto
// exports and imports Ed25519 private keys only as PKCS #8 or JWK.
const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
])

async function exportSeed(
  privateKey: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', privateKey),
  )
  return pkcs8.slice(pkcs8.length - 32)
}

function importSeed(seed: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32)
  pkcs8.set(PKCS8_PREFIX)
  pkcs8.set(seed, PKCS8_PREFIX.length)
  // Extractable, so a restored key can be backed up again.
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, [
    'sign',
  ])
}

async function passphraseKey(
  derive: DeriveBackupKey,
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  kdf: Argon2idParams,
): Promise<CryptoKey> {
  const bytes = await derive(normalizePassphrase(passphrase), salt, kdf)
  return aesKey(bytes)
}

/**
 * HKDF-SHA-256 over the PRF output. The wrapping key uses the record's salt,
 * so re-wrapping the same person key gives a different key each time even
 * though the passkey's secret never changes.
 */
async function hkdf(
  prf: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode(info),
    },
    base,
    256,
  )
  return new Uint8Array(bits)
}

async function passkeyKey(
  prf: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  return aesKey(await hkdf(prf, salt, WRAP_INFO))
}

async function aesKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
  bytes.fill(0)
  return key
}

/**
 * What a client shows a service to fetch its own record. It cannot use the
 * record's salt, because a client needs the token before it has the record. A
 * service holding the token cannot work back to the wrapping key.
 */
export async function personKeyServiceToken(
  prf: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const bytes = await hkdf(prf, new Uint8Array(0), SERVICE_AUTH_INFO)
  const token = toBase64Url(bytes)
  bytes.fill(0)
  return token
}

async function wrapWith(
  keyPair: CryptoKeyPair,
  unlock: UnlockMethod,
  wrappingKey: (salt: Uint8Array<ArrayBuffer>) => Promise<CryptoKey>,
): Promise<PersonKeyBackup> {
  const header = {
    version: BACKUP_FORMAT_VERSION,
    unlock,
    salt: crypto.getRandomValues(new Uint8Array(SALT_LENGTH)),
    nonce: crypto.getRandomValues(new Uint8Array(NONCE_LENGTH)),
    publicKey: new Uint8Array(
      await crypto.subtle.exportKey('raw', keyPair.publicKey),
    ),
  }
  const aes = await wrappingKey(header.salt)
  const seed = await exportSeed(keyPair.privateKey)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: header.nonce, additionalData: encodeHeader(header) },
    aes,
    seed,
  )
  seed.fill(0)
  return { ...header, ciphertext: new Uint8Array(ciphertext) }
}

/** Locks a person key with a passphrase. Its private key must be extractable. */
export function wrapPersonKey(
  keyPair: CryptoKeyPair,
  passphrase: string,
  derive: DeriveBackupKey,
  kdf: Argon2idParams = BACKUP_KDF,
): Promise<PersonKeyBackup> {
  return wrapWith(keyPair, { method: UNLOCK_PASSPHRASE, kdf }, (salt) =>
    passphraseKey(derive, passphrase, salt, kdf),
  )
}

/**
 * Locks a person key with what a passkey ceremony returned. Rejects on a
 * credential id WebAuthn could not have issued, which means the caller passed
 * something other than a ceremony result.
 */
export async function wrapPersonKeyWithPasskey(
  keyPair: CryptoKeyPair,
  passkey: PasskeySecret,
): Promise<PersonKeyBackup> {
  const credentialId = fromBase64Url(passkey.credentialId)
  if (
    !credentialId ||
    credentialId.length < 1 ||
    credentialId.length > MAX_CREDENTIAL_ID_LENGTH
  ) {
    throw new Error('That is not a WebAuthn credential id')
  }
  const unlock: PasskeyUnlock = {
    method: UNLOCK_PASSKEY,
    rpIdHash: await rpIdHash(passkey.rpId),
    credentialId,
  }
  return wrapWith(keyPair, unlock, (salt) => passkeyKey(passkey.prf, salt))
}

async function rpIdHash(rpId: string): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rpId),
  )
  return new Uint8Array(digest)
}

export type UnwrapProblem =
  'wrong-passphrase' | 'wrong-passkey' | 'key-mismatch' | 'wrong-method'

export type UnwrapResult =
  | { ok: true; keyPair: CryptoKeyPair; publicKey: string }
  | { ok: false; problem: UnwrapProblem }

/**
 * A wrong passphrase and a damaged record look the same to AES-GCM. Both come
 * back as wrong-passphrase, which is what a person should check first.
 */
export async function unwrapPersonKey(
  backup: PersonKeyBackup,
  passphrase: string,
  derive: DeriveBackupKey,
): Promise<UnwrapResult> {
  if (backup.unlock.method !== UNLOCK_PASSPHRASE) {
    return { ok: false, problem: 'wrong-method' }
  }
  const aes = await passphraseKey(
    derive,
    passphrase,
    backup.salt,
    backup.unlock.kdf,
  )
  return open(backup, aes, 'wrong-passphrase')
}

/**
 * Unlocks a passkey record with the PRF output of the same ceremony. Another
 * passkey, another relying party or an edited header all fail the same way.
 */
export async function unwrapPersonKeyWithPasskey(
  backup: PersonKeyBackup,
  prf: Uint8Array<ArrayBuffer>,
): Promise<UnwrapResult> {
  if (backup.unlock.method !== UNLOCK_PASSKEY) {
    return { ok: false, problem: 'wrong-method' }
  }
  return open(backup, await passkeyKey(prf, backup.salt), 'wrong-passkey')
}

async function open(
  backup: PersonKeyBackup,
  aes: CryptoKey,
  failure: 'wrong-passphrase' | 'wrong-passkey',
): Promise<UnwrapResult> {
  let seed: Uint8Array<ArrayBuffer>
  try {
    seed = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: backup.nonce,
          additionalData: encodeHeader(backup),
        },
        aes,
        backup.ciphertext,
      ),
    )
  } catch {
    return { ok: false, problem: failure }
  }

  const privateKey = await importSeed(seed)
  seed.fill(0)
  // The JWK of a private key carries its public half as `x`.
  const { x } = await crypto.subtle.exportKey('jwk', privateKey)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x },
    { name: 'Ed25519' },
    true,
    ['verify'],
  )
  const publicKeyText = await exportPublicKey(publicKey)
  if (publicKeyText !== toBase64Url(backup.publicKey)) {
    return { ok: false, problem: 'key-mismatch' }
  }
  return {
    ok: true,
    keyPair: { privateKey, publicKey },
    publicKey: publicKeyText,
  }
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function u32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]
}

function readU16(bytes: Uint8Array): number {
  return ((bytes[0] << 8) | bytes[1]) >>> 0
}

function readU32(bytes: Uint8Array): number {
  return (
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  )
}
