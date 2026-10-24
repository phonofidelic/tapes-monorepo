import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDeviceVouch,
  createVouchRequest,
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
} from '@tapes-monorepo/provenance'
import {
  clearDeviceVouch,
  loadDeviceVouch,
  storeDeviceVouch,
} from './deviceVouch'

/** The host's vouch for this guest, against an in-memory IndexedDB. */

let factory: IDBFactory
const deviceKeys = await generateSigningKeyPair()
const deviceKey = await exportPublicKey(deviceKeys.publicKey)
const hostKeys = await generateSigningKeyPair()
const hostKey = await exportPublicKey(hostKeys.publicKey)

beforeEach(() => {
  factory = new IDBFactory()
})

async function vouch(signer = hostKeys, device = deviceKeys) {
  const request = await createVouchRequest(
    {
      personKey: await exportPublicKey(
        (await generateSigningKeyPair()).publicKey,
      ),
      deviceLabel: 'New phone',
    },
    device,
  )
  return createDeviceVouch(
    {
      request: request.payload,
      hostLabel: 'Studio Mac',
      personName: 'Sam',
      method: 'pin',
      firstCertificate: 'c'.repeat(64),
    },
    signer,
  )
}

describe('storeDeviceVouch', () => {
  it('keeps a vouch the pinned host signed for this device', async () => {
    const signed = await vouch()

    expect(
      await storeDeviceVouch(signed, { hostKey, deviceKey }, factory),
    ).toMatchObject({ ok: true })
    expect(await loadDeviceVouch(factory)).toEqual({
      vouch: signed,
      address: await statementAddress(signed),
    })
  })

  it('refuses a vouch from a host other than the pinned one', async () => {
    const signed = await vouch(await generateSigningKeyPair())

    expect(
      await storeDeviceVouch(signed, { hostKey, deviceKey }, factory),
    ).toEqual({ ok: false, problem: 'other-host' })
    expect(await loadDeviceVouch(factory)).toBeUndefined()
  })

  it('refuses any vouch when no host key is pinned', async () => {
    expect(
      await storeDeviceVouch(
        await vouch(),
        { hostKey: undefined, deviceKey },
        factory,
      ),
    ).toEqual({ ok: false, problem: 'no-pinned-host' })
  })

  it('refuses a vouch for another device key', async () => {
    const signed = await vouch(hostKeys, await generateSigningKeyPair())

    expect(
      await storeDeviceVouch(signed, { hostKey, deviceKey }, factory),
    ).toEqual({ ok: false, problem: 'other-device' })
  })

  it('refuses a vouch whose signature does not verify', async () => {
    const signed = await vouch()
    const changed = {
      ...signed,
      payload: { ...signed.payload, personName: 'Alex' },
    }

    expect(
      await storeDeviceVouch(changed, { hostKey, deviceKey }, factory),
    ).toEqual({ ok: false, problem: 'bad-vouch' })
  })
})

describe('clearDeviceVouch', () => {
  it('drops the stored vouch', async () => {
    await storeDeviceVouch(await vouch(), { hostKey, deviceKey }, factory)

    await clearDeviceVouch(factory)

    expect(await loadDeviceVouch(factory)).toBeUndefined()
  })
})
