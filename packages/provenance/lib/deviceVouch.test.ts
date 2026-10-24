import { describe, expect, it } from 'vitest'
import { createDeviceCertificate } from './deviceCertificate'
import {
  checkDeviceLink,
  checkDeviceVouch,
  checkJoinRequest,
  checkVouchRequest,
  createDeviceVouch,
  createJoinRequest,
  createVouchRequest,
} from './deviceVouch'
import { exportPublicKey, generateSigningKeyPair } from './signing'
import {
  DEVICE_VOUCH_TYPE,
  JOIN_REQUEST_TYPE,
  VOUCH_REQUEST_TYPE,
} from './types'

const deviceKeys = await generateSigningKeyPair()
const hostKeys = await generateSigningKeyPair()
const deviceKey = await exportPublicKey(deviceKeys.publicKey)
const hostKey = await exportPublicKey(hostKeys.publicKey)
const personKeys = await generateSigningKeyPair()
const personKey = await exportPublicKey(personKeys.publicKey)
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

describe('createJoinRequest', () => {
  it('signs the name and challenge with the person key', async () => {
    const signed = await createJoinRequest(
      { personName: 'Sam', certificate: firstCertificate, challenge: 'c1' },
      personKeys,
    )

    expect(signed.payload).toEqual({
      type: JOIN_REQUEST_TYPE,
      personKey,
      personName: 'Sam',
      certificate: firstCertificate,
      challenge: 'c1',
    })
    expect(await checkJoinRequest(signed)).toEqual({
      ok: true,
      request: signed,
    })
  })

  it('rejects a join request with a changed name', async () => {
    const signed = await createJoinRequest(
      { personName: 'Sam', certificate: firstCertificate, challenge: 'c1' },
      personKeys,
    )
    const renamed = {
      ...signed,
      payload: { ...signed.payload, personName: 'Alex' },
    }

    expect(await checkJoinRequest(renamed)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })
})

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

describe('checkDeviceLink', () => {
  it('accepts a certificate or a vouch, and nothing else', async () => {
    const certificate = await createDeviceCertificate(
      { deviceKey, deviceLabel: 'Phone' },
      personKeys,
    )
    const signed = await vouch()

    expect(await checkDeviceLink(certificate)).toEqual({
      ok: true,
      link: certificate,
    })
    expect(await checkDeviceLink(signed)).toEqual({ ok: true, link: signed })
    expect(await checkDeviceLink(await request())).toEqual({
      ok: false,
      problem: 'unknown-type',
    })
  })
})
