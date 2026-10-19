import { signStatement, verifyStatement } from '@tapes-monorepo/provenance'
import { describe, expect, it } from 'vitest'
import {
  encodeBackup,
  decodeBackup,
  parseBackupText,
  toCompact,
  toFileText,
} from './format'
import type { KdfParams } from './kdf'
import { generatePassphrase, normalizePassphrase, WORDS } from './passphrase'
import { generatePersonKey, unwrapPersonKey, wrapPersonKey } from './wrap'

// Cheap settings so the suite stays fast. The format and code path are the
// same as at the proposed parameters.
const FAST: KdfParams[] = [
  { kdf: 'pbkdf2-sha256', iterations: 100_000 },
  { kdf: 'argon2id', memoryKiB: 8 * 1024, iterations: 1, parallelism: 1 },
]

describe.each(FAST)('wrap and unwrap with $kdf', (kdf) => {
  it('restores a key that signs for the same public key', async () => {
    const key = await generatePersonKey()
    const backup = await wrapPersonKey(
      key,
      'Correct Horse  battery staple',
      kdf,
    )
    // Through the text form and back, as a QR or file would carry it.
    const parsed = parseBackupText(toCompact(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const restored = await unwrapPersonKey(
      parsed.backup,
      'correct horse battery staple',
    )
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.key.publicKeyText).toBe(key.publicKeyText)

    const signed = await signStatement(
      { type: 'test', n: 1 },
      restored.key.privateKey,
    )
    expect(await verifyStatement(signed, key.publicKeyText)).toBe(true)
  })

  it('rejects a wrong passphrase', async () => {
    const key = await generatePersonKey()
    const backup = await wrapPersonKey(key, 'one two three four', kdf)
    expect(await unwrapPersonKey(backup, 'one two three five')).toEqual({
      ok: false,
      error: 'wrong-passphrase',
    })
  })

  it('rejects a backup whose header was changed', async () => {
    const key = await generatePersonKey()
    const backup = await wrapPersonKey(key, 'one two three four', kdf)
    const other = await generatePersonKey()
    const swapped = {
      ...backup,
      publicKey: new Uint8Array(
        await crypto.subtle.exportKey('raw', other.publicKey),
      ),
    }
    // The header is authenticated, so this fails at decryption.
    expect((await unwrapPersonKey(swapped, 'one two three four')).ok).toBe(
      false,
    )
  })
})

describe('format', () => {
  it('fits a small QR code', async () => {
    const key = await generatePersonKey()
    for (const kdf of FAST) {
      const compact = toCompact(await wrapPersonKey(key, 'a b c d', kdf))
      expect(compact.startsWith('TPK1.')).toBe(true)
      // 114 bytes for PBKDF2 and 116 for Argon2id: 157 and 160 characters.
      expect(compact.length).toBeLessThanOrEqual(180)
    }
  })

  it('round-trips the binary form', async () => {
    const key = await generatePersonKey()
    const backup = await wrapPersonKey(key, 'a b c d', FAST[1])
    const decoded = decodeBackup(encodeBackup(backup))
    expect(decoded).toEqual({ ok: true, backup })
  })

  it('reads the file form', async () => {
    const key = await generatePersonKey()
    const backup = await wrapPersonKey(key, 'a b c d', FAST[0])
    const parsed = parseBackupText(toFileText(backup))
    expect(parsed).toEqual({ ok: true, backup })
  })

  it.each([
    ['', 'Not a Tapes backup'],
    ['hello', 'Not a Tapes backup'],
    ['TPK2.AAAA', 'This backup was made by a newer version'],
    ['TPK1.!!!!', 'Backup text is damaged'],
    ['TPK1.AQ', 'Backup is too short'],
    ['{"format":"other"}', 'Not a Tapes backup file'],
    ['{nope', 'File is not valid JSON'],
  ])('rejects %j', (text, error) => {
    expect(parseBackupText(text)).toEqual({ ok: false, error })
  })

  it('rejects an unknown version byte and out-of-range Argon2id memory', async () => {
    const key = await generatePersonKey()
    const bytes = encodeBackup(await wrapPersonKey(key, 'a b c d', FAST[1]))
    const wrongVersion = bytes.slice()
    wrongVersion[0] = 9
    expect(decodeBackup(wrongVersion)).toEqual({
      ok: false,
      error: 'Unknown backup version 9',
    })

    const hugeMemory = bytes.slice()
    hugeMemory[2] = 0xff // top byte of memoryKiB
    expect(decodeBackup(hugeMemory)).toEqual({
      ok: false,
      error: 'Argon2id memory size is out of range',
    })

    expect(decodeBackup(bytes.slice(0, -1))).toEqual({
      ok: false,
      error: 'Backup has the wrong length',
    })
  })
})

describe('passphrase', () => {
  it('uses the full EFF long list', () => {
    expect(WORDS.length).toBe(7776)
    expect(new Set(WORDS).size).toBe(7776)
  })

  it('generates six known words', () => {
    const words = generatePassphrase().split(' ')
    expect(words).toHaveLength(6)
    for (const word of words) expect(WORDS).toContain(word)
  })

  it('normalizes what phone keyboards add', () => {
    expect(normalizePassphrase('  Abacus  ablaze.able\tabroad ')).toBe(
      'abacus ablaze able abroad',
    )
    // Hyphens inside EFF words such as t-shirt are kept.
    expect(normalizePassphrase('T-shirt yo-yo')).toBe('t-shirt yo-yo')
  })
})
