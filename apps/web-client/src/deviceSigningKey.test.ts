import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  exportPublicKey,
  signStatement,
  verifyStatement,
} from '@tapes-monorepo/provenance'

/**
 * The guest's signing key against an in-memory IndexedDB. Each fresh module
 * import stands in for a new page load, or for a second tab.
 */

async function freshModule() {
  vi.resetModules()
  return import('./deviceSigningKey')
}

const probe = { type: 'tapes/probe@1', value: 1 }

let factory: IDBFactory

beforeEach(() => {
  factory = new IDBFactory()
})

describe('loadDeviceSigningKey', () => {
  it('creates a non-extractable key pair that signs and verifies', async () => {
    const { loadDeviceSigningKey } = await freshModule()
    const keyPair = await loadDeviceSigningKey(factory)

    expect(keyPair.privateKey.extractable).toBe(false)
    const signed = await signStatement(probe, keyPair.privateKey)
    expect(await verifyStatement(signed, keyPair.publicKey)).toBe(true)
  })

  it('returns the stored key on the next page load', async () => {
    const first = await (await freshModule()).loadDeviceSigningKey(factory)
    const second = await (await freshModule()).loadDeviceSigningKey(factory)

    expect(await exportPublicKey(second.publicKey)).toBe(
      await exportPublicKey(first.publicKey),
    )
    expect(second.privateKey.extractable).toBe(false)
    const signed = await signStatement(probe, second.privateKey)
    expect(await verifyStatement(signed, first.publicKey)).toBe(true)
  })

  it('gives two tabs racing to create a key the same one', async () => {
    const tabA = await freshModule()
    const tabB = await freshModule()

    const [a, b] = await Promise.all([
      tabA.loadDeviceSigningKey(factory),
      tabB.loadDeviceSigningKey(factory),
    ])
    expect(await exportPublicKey(a.publicKey)).toBe(
      await exportPublicKey(b.publicKey),
    )
  })

  it('starts over with a new key in an empty database', async () => {
    const first = await (await freshModule()).loadDeviceSigningKey(factory)
    const other = await (
      await freshModule()
    ).loadDeviceSigningKey(new IDBFactory())

    expect(await exportPublicKey(other.publicKey)).not.toBe(
      await exportPublicKey(first.publicKey),
    )
  })

  it('rejects without IndexedDB, and tries again on the next call', async () => {
    const { loadDeviceSigningKey } = await freshModule()

    await expect(loadDeviceSigningKey(undefined)).rejects.toThrow(
      /no IndexedDB/,
    )
    await expect(loadDeviceSigningKey(factory)).resolves.toBeDefined()
  })
})
