import path from 'path'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  exportPublicKey,
  signStatement,
  verifyStatement,
} from '@tapes-monorepo/provenance'

/**
 * The host's signing key against a fake safeStorage. The fake marks what it
 * encrypts, so a test can tell ciphertext from a key written in the clear.
 */

const state = vi.hoisted(() => ({
  userData: '',
  encryptionAvailable: true,
}))

const ENCRYPTED = 'encrypted:'

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  safeStorage: {
    isEncryptionAvailable: () => state.encryptionAvailable,
    encryptString: (text: string) =>
      Buffer.from(ENCRYPTED + Buffer.from(text).toString('base64')),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString()
      if (!text.startsWith(ENCRYPTED)) {
        throw new Error('Error while decrypting the ciphertext provided')
      }
      return Buffer.from(text.slice(ENCRYPTED.length), 'base64').toString()
    },
  },
}))

const keyPath = () => path.join(state.userData, 'provenance', 'signing-key.bin')

/** A fresh module, as on the next launch of the app. */
async function freshLoad() {
  vi.resetModules()
  const { loadHostSigningKey } = await import('./hostSigningKey')
  return loadHostSigningKey()
}

const probe = { type: 'tapes/probe@1', value: 1 }

beforeEach(() => {
  state.userData = mkdtempSync(path.join(tmpdir(), 'tapes-signing-key-'))
  state.encryptionAvailable = true
})

afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true })
})

describe('loadHostSigningKey', () => {
  it('creates a key pair that signs and verifies', async () => {
    const keyPair = await freshLoad()

    const signed = await signStatement(probe, keyPair.privateKey)
    expect(await verifyStatement(signed, keyPair.publicKey)).toBe(true)
  })

  it('keeps the private key non-extractable once loaded', async () => {
    const created = await freshLoad()
    const reloaded = await freshLoad()

    expect(created.privateKey.extractable).toBe(false)
    expect(reloaded.privateKey.extractable).toBe(false)
  })

  it('stores the key encrypted, readable by its owner only', async () => {
    await freshLoad()

    expect(readFileSync(keyPath(), 'utf-8').startsWith(ENCRYPTED)).toBe(true)
    expect(statSync(keyPath()).mode & 0o777).toBe(0o600)
    expect(readdirSync(path.dirname(keyPath()))).toEqual(['signing-key.bin'])
  })

  it('returns the same key on every launch', async () => {
    const first = await freshLoad()
    const second = await freshLoad()

    expect(await exportPublicKey(second.publicKey)).toBe(
      await exportPublicKey(first.publicKey),
    )
    const signed = await signStatement(probe, second.privateKey)
    expect(await verifyStatement(signed, first.publicKey)).toBe(true)
  })

  it('returns one key to concurrent callers', async () => {
    vi.resetModules()
    const { loadHostSigningKey } = await import('./hostSigningKey')

    const [a, b] = await Promise.all([
      loadHostSigningKey(),
      loadHostSigningKey(),
    ])
    expect(a).toBe(b)
  })

  it('keeps the key out of the TLS directory', async () => {
    await freshLoad()

    expect(keyPath().startsWith(path.join(state.userData, 'sync-tls'))).toBe(
      false,
    )
    expect(existsSync(path.join(state.userData, 'sync-tls'))).toBe(false)
  })

  it('refuses to store a key when the keychain is unavailable', async () => {
    state.encryptionAvailable = false

    await expect(freshLoad()).rejects.toThrow(/safeStorage unavailable/)
    expect(existsSync(keyPath())).toBe(false)
  })

  it('fails without replacing a key it cannot decrypt', async () => {
    await freshLoad()
    writeFileSync(keyPath(), 'not ciphertext')

    await expect(freshLoad()).rejects.toThrow(/Could not decrypt/)
    expect(readFileSync(keyPath(), 'utf-8')).toBe('not ciphertext')
  })

  it('tries again after a failed load', async () => {
    state.encryptionAvailable = false
    vi.resetModules()
    const { loadHostSigningKey } = await import('./hostSigningKey')
    await expect(loadHostSigningKey()).rejects.toThrow()

    state.encryptionAvailable = true
    await expect(loadHostSigningKey()).resolves.toBeDefined()
  })
})
