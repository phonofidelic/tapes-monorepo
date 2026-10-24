import { describe, expect, it } from 'vitest'
import {
  checkDeviceVouch,
  checkVouchRequest,
  createDeviceVouch,
  createVouchRequest,
} from './deviceVouch'
import { exportPublicKey, generateSigningKeyPair } from './signing'
import { DEVICE_VOUCH_TYPE, VOUCH_REQUEST_TYPE } from './types'

const deviceKeys = await generateSigningKeyPair()
const hostKeys = await generateSigningKeyPair()
const deviceKey = await exportPublicKey(deviceKeys.publicKey)
const hostKey = await exportPublicKey(hostKeys.publicKey)
const personKey = await exportPublicKey(
  (await generateSigningKeyPair()).publicKey,
)
const firstCertificate = 'cd'.repeat(32)

const request = () =>
  createVouchRequest(
    {
      personKey,
      deviceLabel: 'iPhone · Safari',
      requestedAt: new Date('2026-10-05T11:49:00.000Z'),
    },
    deviceKeys,
  )

const vouch = async () =>
  createDeviceVouch(
    {
      request: (await request()).payload,
      hostLabel: 'Studio Mac',
      personName: 'Sam',
      method: 'operator',
      firstCertificate,
      vouchedAt: new Date('2026-10-05T11:50:00.000Z'),
    },
    hostKeys,
  )

describe('createVouchRequest', () => {
  it('signs the request with the new device key', async () => {
    const signed = await request()

    expect(signed.payload).toEqual({
      type: VOUCH_REQUEST_TYPE,
      deviceKey,
      personKey,
      deviceLabel: 'iPhone · Safari',
      requestedAt: '2026-10-05T11:49:00.000Z',
    })
    expect(await checkVouchRequest(signed)).toEqual({
      ok: true,
      request: signed,
    })
  })
})

describe('checkVouchRequest', () => {
  it('rejects a request for a different person key', async () => {
    const signed = await request()
    const changed = {
      ...signed,
      payload: { ...signed.payload, personKey: hostKey },
    }

    expect(await checkVouchRequest(changed)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })
})

describe('createDeviceVouch', () => {
  it('signs the request details with the host key', async () => {
    const signed = await vouch()

    expect(signed.payload).toEqual({
      type: DEVICE_VOUCH_TYPE,
      hostKey,
      hostLabel: 'Studio Mac',
      personKey,
      personName: 'Sam',
      deviceKey,
      deviceLabel: 'iPhone · Safari',
      method: 'operator',
      firstCertificate,
      vouchedAt: '2026-10-05T11:50:00.000Z',
    })
    expect(await checkDeviceVouch(signed)).toEqual({ ok: true, vouch: signed })
  })
})

describe('checkDeviceVouch', () => {
  it('rejects a vouch moved to another device key', async () => {
    const signed = await vouch()
    const moved = {
      ...signed,
      payload: { ...signed.payload, deviceKey: hostKey },
    }

    expect(await checkDeviceVouch(moved)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })

  it('rejects a method it does not know', async () => {
    const signed = await vouch()
    const unknown = { ...signed.payload, method: 'guess' }

    expect(await checkDeviceVouch({ ...signed, payload: unknown })).toEqual({
      ok: false,
      problem: 'malformed',
    })
  })
})
