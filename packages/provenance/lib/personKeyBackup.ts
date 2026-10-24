/**
 * The passphrase-locked backup of a person key, version 1. One binary record:
 * version, KDF settings, salt, nonce, the public key, and the AES-256-GCM
 * encrypted 32-byte seed. It travels as `TPK1.` plus base64url, in a QR code
 * or inside a small text file.
 *
 * The KDF is passed in, so this package stays free of WebAssembly. Never change
 * the layout of version 1: backups live in people's files for years.
 */

import { fromBase64Url, toBase64Url } from './encoding'
import { exportPublicKey } from './signing'

export const BACKUP_FORMAT_VERSION = 1

/** Prefix of the text form. The digit is the format version. */
export const BACKUP_TEXT_PREFIX = 'TPK1.'

/** The `format` field of the file form. */
export const BACKUP_FILE_FORMAT = 'tapes-person-key-backup'

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

// The KDF id in the header. Argon2id is the only one accepted.
const KDF_ARGON2ID = 1

const SALT_LENGTH = 16
const NONCE_LENGTH = 12
const PUBLIC_KEY_LENGTH = 32
/** A 32-byte Ed25519 seed plus the 16-byte AES-GCM tag. */
const CIPHERTEXT_LENGTH = 48

export type PersonKeyBackup = {
  version: number
  kdf: Argon2idParams
  salt: Uint8Array<ArrayBuffer>
  nonce: Uint8Array<ArrayBuffer>
  /** In the clear, so a restore can show whose key it is first. */
  publicKey: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

/** Why some text is not a backup this version can open. */
export type BackupProblem =
  'not-a-backup' | 'newer-version' | 'damaged' | 'unsupported-kdf'

export type BackupParse =
  { ok: true; backup: PersonKeyBackup } | { ok: false; problem: BackupProblem }

/**
 * Everything except the ciphertext. It is also the AES-GCM additional data, so
 * changing the KDF settings or the public key makes unlocking fail.
 */
function encodeHeader(
  backup: Omit<PersonKeyBackup, 'ciphertext'>,
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    backup.version,
    KDF_ARGON2ID,
    ...u32(backup.kdf.memoryKiB),
    backup.kdf.iterations & 0xff,
    backup.kdf.parallelism & 0xff,
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

/** Never throws. The bytes come from a camera or a file picker. */
export function decodeBackup(bytes: Uint8Array): BackupParse {
  const fixed = 2 + 6 + SALT_LENGTH + NONCE_LENGTH + PUBLIC_KEY_LENGTH
  if (bytes.length < 2) {
    return { ok: false, problem: 'damaged' }
  }
  if (bytes[0] !== BACKUP_FORMAT_VERSION) {
    return { ok: false, problem: 'newer-version' }
  }
  if (bytes[1] !== KDF_ARGON2ID) {
    return { ok: false, problem: 'unsupported-kdf' }
  }
  if (bytes.length !== fixed + CIPHERTEXT_LENGTH) {
    return { ok: false, problem: 'damaged' }
  }
  let offset = 2
  const take = (n: number) => {
    const slice = new Uint8Array(bytes.subarray(offset, offset + n))
    offset += n
    return slice
  }
  const memoryKiB = readU32(take(4))
  const [iterations, parallelism] = take(2)
  // Refuse sizes a phone cannot allocate rather than crash the tab. Tiny ones
  // mean a broken or hostile file.
  if (
    memoryKiB < 8 * 1024 ||
    memoryKiB > 1024 * 1024 ||
    iterations < 1 ||
    parallelism < 1
  ) {
    return { ok: false, problem: 'unsupported-kdf' }
  }
  return {
    ok: true,
    backup: {
      version: BACKUP_FORMAT_VERSION,
      kdf: { kdf: 'argon2id', memoryKiB, iterations, parallelism },
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
 * The file form: a small JSON object around the text form, so there is one
 * layout to version. It is saved as `.txt`, because Chrome's Web Share refuses
 * `.json` files.
 */
export function backupToFileText(
  backup: PersonKeyBackup,
  createdAt = new Date(),
): string {
  return (
    JSON.stringify(
      {
        format: BACKUP_FILE_FORMAT,
        version: BACKUP_FORMAT_VERSION,
        createdAt: createdAt.toISOString(),
        publicKey: toBase64Url(backup.publicKey),
        backup: backupToText(backup),
        help: 'Tapes person key backup. To restore it, open Tapes and pick this file. You also need your passphrase.',
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

async function wrappingKey(
  derive: DeriveBackupKey,
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  kdf: Argon2idParams,
): Promise<CryptoKey> {
  const bytes = await derive(normalizePassphrase(passphrase), salt, kdf)
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
  bytes.fill(0)
  return key
}

/** Locks a person key. Its private key must be extractable. */
export async function wrapPersonKey(
  keyPair: CryptoKeyPair,
  passphrase: string,
  derive: DeriveBackupKey,
  kdf: Argon2idParams = BACKUP_KDF,
): Promise<PersonKeyBackup> {
  const header = {
    version: BACKUP_FORMAT_VERSION,
    kdf,
    salt: crypto.getRandomValues(new Uint8Array(SALT_LENGTH)),
    nonce: crypto.getRandomValues(new Uint8Array(NONCE_LENGTH)),
    publicKey: new Uint8Array(
      await crypto.subtle.exportKey('raw', keyPair.publicKey),
    ),
  }
  const aesKey = await wrappingKey(derive, passphrase, header.salt, kdf)
  const seed = await exportSeed(keyPair.privateKey)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: header.nonce, additionalData: encodeHeader(header) },
    aesKey,
    seed,
  )
  seed.fill(0)
  return { ...header, ciphertext: new Uint8Array(ciphertext) }
}

export type UnwrapResult =
  | { ok: true; keyPair: CryptoKeyPair; publicKey: string }
  | { ok: false; problem: 'wrong-passphrase' | 'key-mismatch' }

/**
 * A wrong passphrase and a damaged backup look the same to AES-GCM. Both come
 * back as wrong-passphrase, which is what a person should check first.
 */
export async function unwrapPersonKey(
  backup: PersonKeyBackup,
  passphrase: string,
  derive: DeriveBackupKey,
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
    return { ok: false, problem: 'wrong-passphrase' }
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

function u32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]
}

function readU32(bytes: Uint8Array): number {
  return (
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  )
}
