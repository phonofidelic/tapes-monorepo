/**
 * THROWAWAY (TAP-218). The versioned backup format. One binary record, carried
 * two ways: as a short text string in a QR code, or inside a small text file.
 * README.md has the byte layout. Parsing never throws. It returns an
 * error string instead, since the input is whatever a camera or file picker
 * handed over.
 */

import { fromBase64Url, toBase64Url } from '@tapes-monorepo/provenance'
import type { KdfParams } from './kdf'

export const FORMAT_VERSION = 1

/** Prefix of the text form. The digit is the format version. */
export const COMPACT_PREFIX = 'TPK1.'

/** The `format` field of the file form. */
export const FILE_FORMAT = 'tapes-person-key-backup'

const KDF_PBKDF2 = 1
const KDF_ARGON2ID = 2

export const SALT_LENGTH = 16
export const NONCE_LENGTH = 12
/** A 32-byte Ed25519 seed plus the 16-byte AES-GCM tag. */
export const CIPHERTEXT_LENGTH = 48
export const PUBLIC_KEY_LENGTH = 32

export type Backup = {
  version: number
  kdf: KdfParams
  salt: Uint8Array<ArrayBuffer>
  nonce: Uint8Array<ArrayBuffer>
  /** Plaintext on purpose: it lets the restore page show whose key it is. */
  publicKey: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

export type ParseResult =
  { ok: true; backup: Backup } | { ok: false; error: string }

/**
 * Everything except the ciphertext. It is also the AES-GCM additional data,
 * so changing the KDF parameters or the public key makes unwrapping fail.
 */
export function encodeHeader(
  backup: Omit<Backup, 'ciphertext'>,
): Uint8Array<ArrayBuffer> {
  const kdfBytes =
    backup.kdf.kdf === 'pbkdf2-sha256'
      ? [KDF_PBKDF2, ...u32(backup.kdf.iterations)]
      : [
          KDF_ARGON2ID,
          ...u32(backup.kdf.memoryKiB),
          backup.kdf.iterations & 0xff,
          backup.kdf.parallelism & 0xff,
        ]
  return Uint8Array.from([
    backup.version,
    ...kdfBytes,
    ...backup.salt,
    ...backup.nonce,
    ...backup.publicKey,
  ])
}

export function encodeBackup(backup: Backup): Uint8Array<ArrayBuffer> {
  const header = encodeHeader(backup)
  const out = new Uint8Array(header.length + backup.ciphertext.length)
  out.set(header)
  out.set(backup.ciphertext, header.length)
  return out
}

export function decodeBackup(bytes: Uint8Array): ParseResult {
  let offset = 0
  const need = (n: number) => offset + n <= bytes.length
  const take = (n: number) => {
    const slice = new Uint8Array(bytes.subarray(offset, offset + n))
    offset += n
    return slice
  }

  if (!need(2)) return { ok: false, error: 'Backup is too short' }
  const version = bytes[offset++]
  if (version !== FORMAT_VERSION) {
    return { ok: false, error: `Unknown backup version ${version}` }
  }

  let kdf: KdfParams
  const kdfId = bytes[offset++]
  if (kdfId === KDF_PBKDF2) {
    if (!need(4)) return { ok: false, error: 'Backup is too short' }
    kdf = { kdf: 'pbkdf2-sha256', iterations: readU32(take(4)) }
    if (kdf.iterations < 100_000) {
      return { ok: false, error: 'PBKDF2 iteration count is implausibly low' }
    }
  } else if (kdfId === KDF_ARGON2ID) {
    if (!need(6)) return { ok: false, error: 'Backup is too short' }
    const memoryKiB = readU32(take(4))
    const [iterations, parallelism] = take(2)
    kdf = { kdf: 'argon2id', memoryKiB, iterations, parallelism }
    // Refuse sizes a phone cannot allocate rather than crash the tab. Also
    // refuse tiny ones, which would mean a broken or hostile file.
    if (memoryKiB < 8 * 1024 || memoryKiB > 1024 * 1024) {
      return { ok: false, error: 'Argon2id memory size is out of range' }
    }
    if (iterations < 1 || parallelism < 1) {
      return { ok: false, error: 'Argon2id parameters are out of range' }
    }
  } else {
    return { ok: false, error: `Unknown key derivation ${kdfId}` }
  }

  const rest =
    SALT_LENGTH + NONCE_LENGTH + PUBLIC_KEY_LENGTH + CIPHERTEXT_LENGTH
  if (bytes.length - offset !== rest) {
    return { ok: false, error: 'Backup has the wrong length' }
  }
  return {
    ok: true,
    backup: {
      version,
      kdf,
      salt: take(SALT_LENGTH),
      nonce: take(NONCE_LENGTH),
      publicKey: take(PUBLIC_KEY_LENGTH),
      ciphertext: take(CIPHERTEXT_LENGTH),
    },
  }
}

/** The text form, used as the QR payload and inside the file. */
export function toCompact(backup: Backup): string {
  return COMPACT_PREFIX + toBase64Url(encodeBackup(backup))
}

/**
 * The file form: a small JSON object. It carries the compact string rather
 * than its own field layout, so there is one format to version, not two.
 */
export function toFileText(backup: Backup, createdAt = new Date()): string {
  return (
    JSON.stringify(
      {
        format: FILE_FORMAT,
        version: FORMAT_VERSION,
        createdAt: createdAt.toISOString(),
        publicKey: toBase64Url(backup.publicKey),
        backup: toCompact(backup),
        help: 'Tapes person key backup. Open Tapes, choose Restore, and pick this file. You also need your passphrase.',
      },
      null,
      2,
    ) + '\n'
  )
}

/**
 * Accepts the compact string, the file's JSON, or either with stray
 * whitespace around it. A person may paste either into the restore page.
 */
export function parseBackupText(text: string): ParseResult {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch {
      return { ok: false, error: 'File is not valid JSON' }
    }
    if (
      typeof json !== 'object' ||
      json === null ||
      (json as { format?: unknown }).format !== FILE_FORMAT
    ) {
      return { ok: false, error: 'Not a Tapes backup file' }
    }
    const inner = (json as { backup?: unknown }).backup
    if (typeof inner !== 'string') {
      return { ok: false, error: 'Backup file has no backup field' }
    }
    return parseCompact(inner)
  }
  return parseCompact(trimmed)
}

function parseCompact(text: string): ParseResult {
  const trimmed = text.trim()
  if (!trimmed.startsWith('TPK')) {
    return { ok: false, error: 'Not a Tapes backup' }
  }
  if (!trimmed.startsWith(COMPACT_PREFIX)) {
    return { ok: false, error: 'This backup was made by a newer version' }
  }
  const bytes = fromBase64Url(trimmed.slice(COMPACT_PREFIX.length))
  if (!bytes) {
    return { ok: false, error: 'Backup text is damaged' }
  }
  return decodeBackup(bytes)
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
