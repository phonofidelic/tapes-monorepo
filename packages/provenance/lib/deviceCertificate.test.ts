import { describe, expect, it } from 'vitest'
import {
  checkDeviceCertificate,
  createDeviceCertificate,
} from './deviceCertificate'
import { exportPublicKey, generateSigningKeyPair } from './signing'
import { DEVICE_CERTIFICATE_TYPE } from './types'

const personKeys = await generateSigningKeyPair()
const deviceKey = await exportPublicKey(
  (await generateSigningKeyPair()).publicKey,
)

describe('createDeviceCertificate', () => {
  it('signs the device key with the person key', async () => {
    const signed = await createDeviceCertificate(
      {
        deviceKey,
        deviceLabel: 'iPhone · Safari',
        issuedAt: new Date('2026-10-01T09:00:00.000Z'),
      },
      personKeys,
    )

    expect(signed.payload).toEqual({
      type: DEVICE_CERTIFICATE_TYPE,
      personKey: await exportPublicKey(personKeys.publicKey),
      deviceKey,
      deviceLabel: 'iPhone · Safari',
      issuedAt: '2026-10-01T09:00:00.000Z',
    })
    expect(await checkDeviceCertificate(signed)).toEqual({
      ok: true,
      certificate: signed,
    })
  })
})

describe('checkDeviceCertificate', () => {
  it('rejects a certificate with a changed label', async () => {
    const signed = await createDeviceCertificate(
      { deviceKey, deviceLabel: 'Phone' },
      personKeys,
    )
    const changed = {
      ...signed,
      payload: { ...signed.payload, deviceLabel: 'Laptop' },
    }

    expect(await checkDeviceCertificate(changed)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })

  it('rejects a payload of the wrong shape', async () => {
    const signed = await createDeviceCertificate(
      { deviceKey, deviceLabel: 'Phone' },
      personKeys,
    )
    const unlabelled = { ...signed.payload, deviceLabel: undefined }

    expect(
      await checkDeviceCertificate({ ...signed, payload: unlabelled }),
    ).toEqual({ ok: false, problem: 'malformed' })
  })
})
