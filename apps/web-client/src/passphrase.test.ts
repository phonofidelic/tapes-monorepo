import { describe, expect, it } from 'vitest'
import {
  exportPublicKey,
  generateSigningKeyPair,
  unwrapPersonKey,
  wrapPersonKey,
} from '@tapes-monorepo/provenance'
import {
  deriveArgon2id,
  generatePassphrase,
  PASSPHRASE_WORDS,
  WORDS,
} from './passphrase'

describe('generatePassphrase', () => {
  it('uses the full EFF long list', () => {
    expect(WORDS).toHaveLength(7776)
    expect(new Set(WORDS).size).toBe(7776)
  })

  it('picks six words from it', () => {
    const words = generatePassphrase().split(' ')
    expect(words).toHaveLength(PASSPHRASE_WORDS)
    for (const word of words) {
      expect(WORDS).toContain(word)
    }
  })
})

describe('deriveArgon2id', () => {
  // The smallest memory the backup format accepts, so the test stays fast.
  const fast = {
    kdf: 'argon2id',
    memoryKiB: 8 * 1024,
    iterations: 1,
    parallelism: 1,
  } as const

  it('is deterministic for a passphrase and salt', async () => {
    const salt = new Uint8Array(16).fill(7)
    const a = await deriveArgon2id('one two', salt, fast)
    const b = await deriveArgon2id('one two', salt, fast)
    const c = await deriveArgon2id('one three', salt, fast)

    expect(a).toHaveLength(32)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('wraps and unwraps a person key', async () => {
    const keyPair = await generateSigningKeyPair(true)
    const passphrase = generatePassphrase()
    const backup = await wrapPersonKey(
      keyPair,
      passphrase,
      deriveArgon2id,
      fast,
    )

    const restored = await unwrapPersonKey(
      backup,
      passphrase.toUpperCase(),
      deriveArgon2id,
    )
    expect(restored).toMatchObject({
      ok: true,
      publicKey: await exportPublicKey(keyPair.publicKey),
    })
  })
})
