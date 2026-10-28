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
  markPersonKeyJoined,
  restorePersonIdentity,
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

describe('markPersonKeyJoined', () => {
  it('records when the host added the person, next to the backup time', async () => {
    const { publicKey } = await createPersonIdentity(device, factory)
    await markPersonKeyBackedUp(
      publicKey,
      new Date('2026-10-22T10:00:00Z'),
      factory,
    )
    await markPersonKeyJoined(
      publicKey,
      new Date('2026-10-22T09:00:00Z'),
      factory,
    )

    expect(await loadPersonIdentity(factory)).toMatchObject({
      backedUpAt: '2026-10-22T10:00:00.000Z',
      joinedAt: '2026-10-22T09:00:00.000Z',
    })
  })
})

describe('restorePersonIdentity', () => {
  const restoredAt = new Date('2026-10-24T12:00:00Z')

  it('stores the restored key with a new certificate for this device', async () => {
    const personKeys = await generateSigningKeyPair(true)

    const result = await restorePersonIdentity(
      device,
      { keyPair: personKeys, backedUpAt: restoredAt, joinedAt: 'earlier' },
      factory,
    )

    expect(result.ok).toBe(true)
    const identity = await loadPersonIdentity(factory)
    expect(identity).toMatchObject({
      publicKey: await exportPublicKey(personKeys.publicKey),
      backedUpAt: restoredAt.toISOString(),
      joinedAt: 'earlier',
    })
    expect(await checkDeviceCertificate(identity!.certificate)).toMatchObject({
      ok: true,
      certificate: {
        payload: {
          deviceKey: await exportPublicKey(device.keyPair.publicKey),
          deviceLabel: 'Pixel · Chrome',
        },
      },
    })
  })

  it('keeps the certificate of a device that already holds the key', async () => {
    const existing = await createPersonIdentity(device, factory)

    await restorePersonIdentity(
      device,
      { keyPair: existing.keyPair, backedUpAt: restoredAt },
      factory,
    )

    expect(await loadPersonIdentity(factory)).toMatchObject({
      certificateAddress: existing.certificateAddress,
      backedUpAt: restoredAt.toISOString(),
    })
  })

  it('refuses a backup of another person key', async () => {
    const existing = await createPersonIdentity(device, factory)

    expect(
      await restorePersonIdentity(
        device,
        {
          keyPair: await generateSigningKeyPair(true),
          backedUpAt: restoredAt,
        },
        factory,
      ),
    ).toEqual({ ok: false, problem: 'other-person-key' })
    expect((await loadPersonIdentity(factory))?.publicKey).toBe(
      existing.publicKey,
    )
  })
})
