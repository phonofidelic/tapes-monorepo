// THROWAWAY PROTOTYPE (TAP-219).
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
  verifyStatement,
} from '@tapes-monorepo/provenance'
import {
  checkDeviceVouch,
  checkPersonCertificate,
  checkVouchRequest,
  createDeviceVouch,
  createPersonCertificate,
  createVouchRequest,
  DEVICE_VOUCH_TYPE,
  resolveDeviceLink,
} from './statements'

const at = new Date('2026-10-19T18:00:00.000Z')

async function setup() {
  const person = await generateSigningKeyPair()
  const oldDevice = await generateSigningKeyPair()
  const newDevice = await generateSigningKeyPair()
  const host = await generateSigningKeyPair()
  const personKey = await exportPublicKey(person.publicKey)
  const hostKey = await exportPublicKey(host.publicKey)
  const cert = await createPersonCertificate(
    {
      deviceKey: await exportPublicKey(oldDevice.publicKey),
      deviceLabel: 'iPhone · Safari',
      issuedAt: at,
    },
    person,
  )
  const request = await createVouchRequest(
    { personKey, deviceLabel: 'iPhone · Safari', requestedAt: at },
    newDevice,
  )
  const vouch = await createDeviceVouch(
    {
      request: request.payload,
      personName: 'Sam',
      method: 'operator',
      basis: await statementAddress(cert),
      vouchedAt: at,
    },
    host,
  )
  return { person, newDevice, host, personKey, hostKey, cert, request, vouch }
}

describe('createDeviceVouch', () => {
  it('signs a vouch naming the new device, the person and the host', async () => {
    const { vouch, request, personKey, hostKey, cert } = await setup()

    expect(vouch.payload).toEqual({
      type: DEVICE_VOUCH_TYPE,
      deviceKey: request.payload.deviceKey,
      personKey,
      personName: 'Sam',
      deviceLabel: 'iPhone · Safari',
      method: 'operator',
      basis: await statementAddress(cert),
      vouchedAt: at.toISOString(),
      hostKey,
    })
    expect(await verifyStatement(vouch, hostKey)).toBe(true)
  })

  it('signs canonical JSON, so key order does not matter', async () => {
    const { vouch, hostKey } = await setup()
    const reordered = {
      payload: Object.fromEntries(Object.entries(vouch.payload).reverse()),
      signature: vouch.signature,
    }
    expect(canonicalJson(reordered.payload)).toBe(canonicalJson(vouch.payload))
    expect(await verifyStatement(reordered, hostKey)).toBe(true)
  })
})

describe('checkDeviceVouch', () => {
  it('accepts a vouch from a pinned host', async () => {
    const { vouch, hostKey } = await setup()
    expect(await checkDeviceVouch(vouch, [hostKey])).toMatchObject({ ok: true })
  })

  it('rejects a vouch from a host that is not pinned', async () => {
    const { vouch } = await setup()
    const other = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )
    expect(await checkDeviceVouch(vouch, [other])).toEqual({
      ok: false,
      problem: 'untrusted-host',
    })
  })

  it('rejects a vouch whose device key was swapped', async () => {
    const { vouch, hostKey } = await setup()
    const swapped = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )
    const tampered = {
      ...vouch,
      payload: { ...vouch.payload, deviceKey: swapped },
    }
    expect(await checkDeviceVouch(tampered, [hostKey])).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })

  it('rejects a vouch that names a different host key than signed it', async () => {
    const { vouch } = await setup()
    const otherHost = await generateSigningKeyPair()
    const forged = {
      ...vouch,
      payload: {
        ...vouch.payload,
        hostKey: await exportPublicKey(otherHost.publicKey),
      },
    }
    expect(await checkDeviceVouch(forged)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })

  it('rejects malformed payloads', async () => {
    const { vouch } = await setup()
    for (const payload of [
      null,
      'vouch',
      { ...vouch.payload, method: 'telepathy' },
      { ...vouch.payload, type: 'tapes/recording@1' },
      { ...vouch.payload, personKey: undefined },
    ]) {
      expect(
        await checkDeviceVouch({ payload, signature: vouch.signature }),
      ).toEqual({ ok: false, problem: 'malformed' })
    }
  })
})

describe('checkVouchRequest and checkPersonCertificate', () => {
  it('accept their own statements', async () => {
    const { request, cert } = await setup()
    expect((await checkVouchRequest(request)).ok).toBe(true)
    expect((await checkPersonCertificate(cert)).ok).toBe(true)
  })

  it('reject a request signed by a key other than the one it names', async () => {
    const { request } = await setup()
    const other = await generateSigningKeyPair()
    const claimed = await createVouchRequest(
      { personKey: request.payload.personKey, requestedAt: at },
      other,
    )
    const mixed = { payload: request.payload, signature: claimed.signature }
    expect(await checkVouchRequest(mixed)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })
})

describe('resolveDeviceLink', () => {
  it('prefers a person-key certificate', async () => {
    const { person, newDevice, personKey, hostKey } = await setup()
    const deviceKey = await exportPublicKey(newDevice.publicKey)
    const cert = await createPersonCertificate(
      { deviceKey, issuedAt: at },
      person,
    )
    expect(await resolveDeviceLink(cert, deviceKey, [hostKey])).toEqual({
      personKey,
      via: 'person-key',
    })
  })

  it('labels a vouch by whether this verifier trusts the host', async () => {
    const { vouch, personKey, hostKey } = await setup()
    const deviceKey = vouch.payload.deviceKey

    expect(await resolveDeviceLink(vouch, deviceKey, [hostKey])).toEqual({
      personKey,
      via: 'trusted-host',
      hostKey,
      method: 'operator',
    })
    expect(await resolveDeviceLink(vouch, deviceKey, [])).toMatchObject({
      via: 'other-host',
    })
  })

  it('returns undefined for a statement about another device', async () => {
    const { vouch, cert, hostKey } = await setup()
    const other = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )
    expect(await resolveDeviceLink(vouch, other, [hostKey])).toBeUndefined()
    expect(await resolveDeviceLink(cert, other, [hostKey])).toBeUndefined()
  })
})
