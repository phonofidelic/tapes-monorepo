import { describe, expect, it } from 'vitest'
import { toBase64Url } from './encoding'
import {
  BACKUP_KDF,
  backupToFileText,
  backupToText,
  decodeBackup,
  encodeBackup,
  normalizePassphrase,
  parseBackupText,
  unwrapPersonKey,
  wrapPersonKey,
  type DeriveBackupKey,
} from './personKeyBackup'
import {
  exportPublicKey,
  generateSigningKeyPair,
  signStatement,
  verifyStatement,
} from './signing'

// The real KDF is Argon2id in the web client. Any keyed derivation exercises
// the format and the wrap, so the tests use cheap PBKDF2 from WebCrypto.
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

const personKey = () => generateSigningKeyPair(true)

describe('wrapPersonKey and unwrapPersonKey', () => {
  it('restores a key that signs for the same public key', async () => {
    const keyPair = await personKey()
    const backup = await wrapPersonKey(
      keyPair,
      'Correct Horse  battery staple',
      derive,
    )
    // Through the text form and back, as a QR code or file carries it.
    const parsed = parseBackupText(backupToText(backup))
    if (!parsed.ok) throw new Error(parsed.problem)

    const restored = await unwrapPersonKey(
      parsed.backup,
      'correct horse battery staple',
      derive,
    )
    if (!restored.ok) throw new Error(restored.problem)
    const publicKey = await exportPublicKey(keyPair.publicKey)
    expect(restored.publicKey).toBe(publicKey)

    const signed = await signStatement(
      { type: 'test' },
      restored.keyPair.privateKey,
    )
    expect(await verifyStatement(signed, publicKey)).toBe(true)
  })

  it('rejects a wrong passphrase', async () => {
    const backup = await wrapPersonKey(
      await personKey(),
      'one two three four',
      derive,
    )
    expect(await unwrapPersonKey(backup, 'one two three five', derive)).toEqual(
      { ok: false, problem: 'wrong-passphrase' },
    )
  })

  it('rejects a backup whose public key was swapped', async () => {
    const backup = await wrapPersonKey(
      await personKey(),
      'one two three four',
      derive,
    )
    const other = await personKey()
    const swapped = {
      ...backup,
      publicKey: new Uint8Array(
        await crypto.subtle.exportKey('raw', other.publicKey),
      ),
    }
    // The header is the additional data, so decryption fails.
    expect(
      await unwrapPersonKey(swapped, 'one two three four', derive),
    ).toEqual({ ok: false, problem: 'wrong-passphrase' })
  })

  it('records the proposed Argon2id settings by default', async () => {
    const backup = await wrapPersonKey(await personKey(), 'a b c d', derive)
    expect(backup.kdf).toEqual(BACKUP_KDF)
    expect(BACKUP_KDF).toEqual({
      kdf: 'argon2id',
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
    })
  })
})

describe('backup format', () => {
  it('is 116 bytes, and 160 characters as text', async () => {
    const backup = await wrapPersonKey(await personKey(), 'a b c d', derive)
    expect(encodeBackup(backup)).toHaveLength(116)
    const text = backupToText(backup)
    expect(text.startsWith('TPK1.')).toBe(true)
    expect(text).toHaveLength(160)
  })

  it('round-trips the binary form', async () => {
    const backup = await wrapPersonKey(await personKey(), 'a b c d', derive)
    expect(decodeBackup(encodeBackup(backup))).toEqual({ ok: true, backup })
  })

  it('reads the file form', async () => {
    const keyPair = await personKey()
    const backup = await wrapPersonKey(keyPair, 'a b c d', derive)
    const file = backupToFileText(backup, new Date('2026-10-22T10:00:00Z'))

    expect(JSON.parse(file)).toMatchObject({
      format: 'tapes-person-key-backup',
      version: 1,
      createdAt: '2026-10-22T10:00:00.000Z',
      publicKey: await exportPublicKey(keyPair.publicKey),
    })
    expect(parseBackupText(file)).toEqual({ ok: true, backup })
  })

  it.each([
    ['', 'not-a-backup'],
    ['hello', 'not-a-backup'],
    ['TPK2.AAAA', 'newer-version'],
    ['TPK1.!!!!', 'damaged'],
    ['TPK1.AQ', 'damaged'],
    ['{"format":"other"}', 'not-a-backup'],
    ['{"format":"tapes-person-key-backup"}', 'damaged'],
    ['{nope', 'not-a-backup'],
  ])('rejects %j', (text, problem) => {
    expect(parseBackupText(text)).toEqual({ ok: false, problem })
  })

  it('rejects an unknown version, a PBKDF2 id and out-of-range memory', async () => {
    const bytes = encodeBackup(
      await wrapPersonKey(await personKey(), 'a b c d', derive),
    )
    const wrongVersion = bytes.slice()
    wrongVersion[0] = 9
    expect(decodeBackup(wrongVersion)).toEqual({
      ok: false,
      problem: 'newer-version',
    })

    const pbkdf2 = bytes.slice()
    pbkdf2[1] = 1
    expect(decodeBackup(pbkdf2)).toEqual({
      ok: false,
      problem: 'unsupported-kdf',
    })

    const hugeMemory = bytes.slice()
    hugeMemory[2] = 0xff
    expect(decodeBackup(hugeMemory)).toEqual({
      ok: false,
      problem: 'unsupported-kdf',
    })

    expect(decodeBackup(bytes.slice(0, -1))).toEqual({
      ok: false,
      problem: 'damaged',
    })
  })

  it('keeps the public key in the clear', async () => {
    const keyPair = await personKey()
    const backup = await wrapPersonKey(keyPair, 'a b c d', derive)
    expect(toBase64Url(backup.publicKey)).toBe(
      await exportPublicKey(keyPair.publicKey),
    )
  })
})

describe('normalizePassphrase', () => {
  it('ignores what phone keyboards add', () => {
    expect(normalizePassphrase('  Abacus  ablaze.able\tabroad ')).toBe(
      'abacus ablaze able abroad',
    )
  })

  it('keeps hyphens inside words', () => {
    expect(normalizePassphrase('T-shirt yo-yo')).toBe('t-shirt yo-yo')
  })
})
