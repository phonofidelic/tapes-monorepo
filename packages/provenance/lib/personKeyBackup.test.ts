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
  passkeyRecordKey,
  unwrapPersonKey,
  unwrapPersonKeyWithPasskey,
  wrapPersonKey,
  wrapPersonKeyWithPasskey,
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
    expect(backup.unlock).toEqual({ method: 1, kdf: BACKUP_KDF })
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

  it('rejects an unknown version, an unknown method and out-of-range memory', async () => {
    const bytes = encodeBackup(
      await wrapPersonKey(await personKey(), 'a b c d', derive),
    )
    const wrongVersion = bytes.slice()
    wrongVersion[0] = 9
    expect(decodeBackup(wrongVersion)).toEqual({
      ok: false,
      problem: 'newer-version',
    })

    const unknownMethod = bytes.slice()
    unknownMethod[1] = 9
    expect(decodeBackup(unknownMethod)).toEqual({
      ok: false,
      problem: 'unsupported-method',
    })

    const hugeMemory = bytes.slice()
    hugeMemory[2] = 0xff
    expect(decodeBackup(hugeMemory)).toEqual({
      ok: false,
      problem: 'unsupported-method',
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

/** A ceremony's answer, as the record needs it. */
const passkey = () => ({
  prf: crypto.getRandomValues(new Uint8Array(32)),
  rpId: 'tapes.network',
  credentialId: toBase64Url(crypto.getRandomValues(new Uint8Array(20))),
})

describe('wrapPersonKeyWithPasskey and unwrapPersonKeyWithPasskey', () => {
  it('restores a key the same PRF output locked', async () => {
    const keyPair = await personKey()
    const secret = passkey()
    const backup = await wrapPersonKeyWithPasskey(keyPair, secret)
    // Through the text form and back, as a stored record carries it.
    const parsed = parseBackupText(backupToText(backup))
    if (!parsed.ok) throw new Error(parsed.problem)

    const restored = await unwrapPersonKeyWithPasskey(parsed.backup, secret.prf)
    if (!restored.ok) throw new Error(restored.problem)
    const publicKey = await exportPublicKey(keyPair.publicKey)
    expect(restored.publicKey).toBe(publicKey)

    const signed = await signStatement(
      { type: 'test' },
      restored.keyPair.privateKey,
    )
    expect(await verifyStatement(signed, publicKey)).toBe(true)
  })

  it("rejects another passkey's PRF output", async () => {
    const backup = await wrapPersonKeyWithPasskey(await personKey(), passkey())
    expect(
      await unwrapPersonKeyWithPasskey(
        backup,
        crypto.getRandomValues(new Uint8Array(32)),
      ),
    ).toEqual({ ok: false, problem: 'wrong-passkey' })
  })

  it('gives each record its own wrapping key', async () => {
    const keyPair = await personKey()
    const secret = passkey()
    const first = await wrapPersonKeyWithPasskey(keyPair, secret)
    const second = await wrapPersonKeyWithPasskey(keyPair, secret)

    // The same passkey yields the same secret, so only the per-record salt
    // and nonce keep two records apart.
    expect(toBase64Url(first.salt)).not.toBe(toBase64Url(second.salt))
    expect(toBase64Url(first.nonce)).not.toBe(toBase64Url(second.nonce))
    expect(toBase64Url(first.ciphertext)).not.toBe(
      toBase64Url(second.ciphertext),
    )
    expect((await unwrapPersonKeyWithPasskey(second, secret.prf)).ok).toBe(true)
  })

  it('binds the record to its credential and relying party', async () => {
    const secret = passkey()
    const backup = await wrapPersonKeyWithPasskey(await personKey(), secret)
    if (backup.unlock.method !== 2) throw new Error('not method 2')

    // The header is the additional data, so an edit anywhere in it fails.
    const credentialId = backup.unlock.credentialId.slice()
    credentialId[0] ^= 0xff
    expect(
      await unwrapPersonKeyWithPasskey(
        { ...backup, unlock: { ...backup.unlock, credentialId } },
        secret.prf,
      ),
    ).toEqual({ ok: false, problem: 'wrong-passkey' })

    const rpIdHash = backup.unlock.rpIdHash.slice()
    rpIdHash[0] ^= 0xff
    expect(
      await unwrapPersonKeyWithPasskey(
        { ...backup, unlock: { ...backup.unlock, rpIdHash } },
        secret.prf,
      ),
    ).toEqual({ ok: false, problem: 'wrong-passkey' })
  })

  it('refuses a record locked the other way', async () => {
    const keyPair = await personKey()
    const secret = passkey()
    const withPasskey = await wrapPersonKeyWithPasskey(keyPair, secret)
    const withPassphrase = await wrapPersonKey(keyPair, 'a b c d', derive)

    expect(await unwrapPersonKey(withPasskey, 'a b c d', derive)).toEqual({
      ok: false,
      problem: 'wrong-method',
    })
    expect(
      await unwrapPersonKeyWithPasskey(withPassphrase, secret.prf),
    ).toEqual({ ok: false, problem: 'wrong-method' })
  })

  it('refuses a credential id WebAuthn could not have issued', async () => {
    const keyPair = await personKey()
    await expect(
      wrapPersonKeyWithPasskey(keyPair, { ...passkey(), credentialId: '' }),
    ).rejects.toThrow('credential id')
    await expect(
      wrapPersonKeyWithPasskey(keyPair, {
        ...passkey(),
        credentialId: toBase64Url(new Uint8Array(1024)),
      }),
    ).rejects.toThrow('credential id')
  })
})

describe('passkey record format', () => {
  it('is 144 bytes plus the credential id', async () => {
    const backup = await wrapPersonKeyWithPasskey(await personKey(), passkey())
    expect(encodeBackup(backup)).toHaveLength(164)
    expect(decodeBackup(encodeBackup(backup))).toEqual({ ok: true, backup })
  })

  it('rejects a credential id length that does not fit the record', async () => {
    const bytes = encodeBackup(
      await wrapPersonKeyWithPasskey(await personKey(), passkey()),
    )
    const empty = bytes.slice()
    empty[34] = 0
    empty[35] = 0
    expect(decodeBackup(empty)).toEqual({ ok: false, problem: 'damaged' })

    const tooLong = bytes.slice()
    tooLong[34] = 0xff
    tooLong[35] = 0xff
    expect(decodeBackup(tooLong)).toEqual({ ok: false, problem: 'damaged' })

    const mismatched = bytes.slice()
    mismatched[35] = 21
    expect(decodeBackup(mismatched)).toEqual({ ok: false, problem: 'damaged' })

    expect(decodeBackup(bytes.slice(0, 20))).toEqual({
      ok: false,
      problem: 'damaged',
    })
  })

  it('is stored under its credential id', async () => {
    const secret = passkey()
    const backup = await wrapPersonKeyWithPasskey(await personKey(), secret)
    expect(passkeyRecordKey(backup)).toBe(secret.credentialId)
    expect(
      passkeyRecordKey(await wrapPersonKey(await personKey(), 'a b', derive)),
    ).toBeUndefined()
  })

  it('tells a person in the file what unlocks it', async () => {
    const backup = await wrapPersonKeyWithPasskey(await personKey(), passkey())
    const file = JSON.parse(backupToFileText(backup)) as { help: string }
    expect(file.help).toContain('passkey')
  })
})
