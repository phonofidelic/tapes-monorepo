import { describe, expect, it } from 'vitest'
import { createDeviceCertificate } from './deviceCertificate'
import {
  checkDeviceRevocation,
  createDeviceRevocation,
  revocationCovers,
} from './deviceRevocation'
import { createDeviceVouch, createVouchRequest } from './deviceVouch'
import {
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
} from './signing'
import { DEVICE_REVOCATION_TYPE } from './types'

const personKeys = await generateSigningKeyPair()
const hostKeys = await generateSigningKeyPair()
const deviceKeys = await generateSigningKeyPair()
const personKey = await exportPublicKey(personKeys.publicKey)
const hostKey = await exportPublicKey(hostKeys.publicKey)
const deviceKey = await exportPublicKey(deviceKeys.publicKey)

const certificate = await createDeviceCertificate(
  { deviceKey, deviceLabel: 'Lost phone' },
  personKeys,
)
const certificateAddress = await statementAddress(certificate)

const vouch = await createDeviceVouch(
  {
    request: (
      await createVouchRequest(
        { personKey, deviceLabel: 'Lost phone' },
        deviceKeys,
      )
    ).payload,
    hostLabel: 'Studio Mac',
    personName: 'Sam',
    method: 'operator',
    firstCertificate: certificateAddress,
  },
  hostKeys,
)
const vouchAddress = await statementAddress(vouch)

function revoke(
  details: Partial<Parameters<typeof createDeviceRevocation>[0]> = {},
  keyPair = personKeys,
) {
  return createDeviceRevocation(
    {
      signedBy: 'person',
      deviceKey,
      deviceLink: certificateAddress,
      reason: 'lost',
      revokedAt: new Date('2026-10-20T08:00:00.000Z'),
      ...details,
    },
    keyPair,
  )
}

describe('createDeviceRevocation', () => {
  it('signs the device key and the statement it withdraws', async () => {
    const signed = await revoke()

    expect(signed.payload).toEqual({
      type: DEVICE_REVOCATION_TYPE,
      signerKey: personKey,
      signedBy: 'person',
      deviceKey,
      deviceLink: certificateAddress,
      reason: 'lost',
      revokedAt: '2026-10-20T08:00:00.000Z',
    })
    expect(await checkDeviceRevocation(signed)).toEqual({
      ok: true,
      revocation: signed,
    })
  })
})

describe('checkDeviceRevocation', () => {
  it('rejects a revocation whose device key was changed', async () => {
    const signed = await revoke()
    const changed = {
      ...signed,
      payload: { ...signed.payload, deviceKey: hostKey },
    }

    expect(await checkDeviceRevocation(changed)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })

  it('rejects an unknown reason', async () => {
    const signed = await revoke()
    const payload = { ...signed.payload, reason: 'bored' }

    expect(await checkDeviceRevocation({ ...signed, payload })).toEqual({
      ok: false,
      problem: 'malformed',
    })
  })
})

describe('revocationCovers', () => {
  it('lets a person key withdraw its own certificate', async () => {
    const signed = await revoke()

    expect(
      revocationCovers(signed.payload, certificate.payload, certificateAddress),
    ).toBe(true)
  })

  it('lets a person key withdraw a vouch made in their name', async () => {
    const signed = await revoke({ deviceLink: vouchAddress })

    expect(revocationCovers(signed.payload, vouch.payload, vouchAddress)).toBe(
      true,
    )
  })

  it('lets a host withdraw a vouch it signed', async () => {
    const signed = await revoke(
      { signedBy: 'host', deviceLink: vouchAddress, reason: 'wrong-person' },
      hostKeys,
    )

    expect(revocationCovers(signed.payload, vouch.payload, vouchAddress)).toBe(
      true,
    )
  })

  it('refuses a host withdrawing a person key certificate', async () => {
    const signed = await revoke({ signedBy: 'host' }, hostKeys)

    expect(
      revocationCovers(signed.payload, certificate.payload, certificateAddress),
    ).toBe(false)
  })

  it('refuses a person key withdrawing another person key certificate', async () => {
    const signed = await revoke({}, await generateSigningKeyPair())

    expect(
      revocationCovers(signed.payload, certificate.payload, certificateAddress),
    ).toBe(false)
  })

  it('refuses a revocation for a different statement', async () => {
    const signed = await revoke()

    expect(revocationCovers(signed.payload, vouch.payload, vouchAddress)).toBe(
      false,
    )
  })

  it('refuses a revocation for a different device key', async () => {
    const signed = await revoke({ deviceKey: hostKey })

    expect(
      revocationCovers(signed.payload, certificate.payload, certificateAddress),
    ).toBe(false)
  })
})
