import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  checkDeviceCertificate,
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
} from '@tapes-monorepo/provenance'
import {
  createPersonIdentity,
  loadPersonIdentity,
  markPersonKeyBackedUp,
} from './personKey'

/** The guest's person key against an in-memory IndexedDB. */

let factory: IDBFactory
let device: { keyPair: CryptoKeyPair; label: string }

beforeEach(async () => {
  factory = new IDBFactory()
  device = { keyPair: await generateSigningKeyPair(), label: 'Pixel · Chrome' }
})

describe('createPersonIdentity', () => {
  it('certifies the device key with a new, extractable person key', async () => {
    const identity = await createPersonIdentity(device, factory)

    expect(identity.keyPair.privateKey.extractable).toBe(true)
    expect(identity.publicKey).toBe(
      await exportPublicKey(identity.keyPair.publicKey),
    )
    expect(await checkDeviceCertificate(identity.certificate)).toMatchObject({
      ok: true,
    })
    expect(identity.certificate.payload).toMatchObject({
      personKey: identity.publicKey,
      deviceKey: await exportPublicKey(device.keyPair.publicKey),
      deviceLabel: 'Pixel · Chrome',
    })
    expect(identity.certificateAddress).toBe(
      await statementAddress(identity.certificate),
    )
    expect(identity.backedUpAt).toBeUndefined()
  })

  it('keeps the first person key on a second call', async () => {
    const first = await createPersonIdentity(device, factory)
    const second = await createPersonIdentity(
      { ...device, label: 'Renamed' },
      factory,
    )

    expect(second.publicKey).toBe(first.publicKey)
    expect(second.certificateAddress).toBe(first.certificateAddress)
  })

  it('lets one of two racing creations win', async () => {
    const [a, b] = await Promise.all([
      createPersonIdentity(device, factory),
      createPersonIdentity(device, factory),
    ])
    const stored = await loadPersonIdentity(factory)

    expect(a.publicKey).toBe(b.publicKey)
    expect(stored?.publicKey).toBe(a.publicKey)
  })
})

describe('loadPersonIdentity', () => {
  it('is undefined before the first join', async () => {
    expect(await loadPersonIdentity(factory)).toBeUndefined()
  })

  it('rejects without IndexedDB', async () => {
    await expect(loadPersonIdentity(undefined)).rejects.toThrow(/no IndexedDB/)
  })
})

describe('markPersonKeyBackedUp', () => {
  it('records when the backup was checked', async () => {
    const { publicKey } = await createPersonIdentity(device, factory)
    await markPersonKeyBackedUp(
      publicKey,
      new Date('2026-10-22T10:00:00Z'),
      factory,
    )

    expect(await loadPersonIdentity(factory)).toMatchObject({
      publicKey,
      backedUpAt: '2026-10-22T10:00:00.000Z',
    })
  })

  it('refuses a backup of another person key', async () => {
    await createPersonIdentity(device, factory)
    const other = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )

    await expect(
      markPersonKeyBackedUp(other, new Date(), factory),
    ).rejects.toThrow(/different person key/)
  })
})
