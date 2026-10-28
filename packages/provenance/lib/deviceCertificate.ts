/**
 * The certificate a person key signs for each device the person records from.
 * A claim names its certificate by address, so a recording traces back to a
 * person and not only to a device.
 *
 * A certificate proves the person key vouched for the device key. It does not
 * say who the person is. The label is the person's own name for the device.
 */

import { exportPublicKey, signStatement, verifyStatement } from './signing'
import {
  DEVICE_CERTIFICATE_TYPE,
  type DeviceCertificate,
  type Signed,
} from './types'

/**
 * The HTTP header a guest sends its certificate in, next to the claim. A guest
 * whose device a host vouched for sends the vouch in it instead.
 */
export const DEVICE_CERTIFICATE_HEADER = 'X-Tapes-Device-Certificate'

export async function createDeviceCertificate(
  details: { deviceKey: string; deviceLabel: string; issuedAt?: Date },
  personKeyPair: CryptoKeyPair,
): Promise<Signed<DeviceCertificate>> {
  return signStatement(
    {
      type: DEVICE_CERTIFICATE_TYPE,
      personKey: await exportPublicKey(personKeyPair.publicKey),
      deviceKey: details.deviceKey,
      deviceLabel: details.deviceLabel,
      issuedAt: (details.issuedAt ?? new Date()).toISOString(),
    },
    personKeyPair.privateKey,
  )
}

/** Why a device certificate did not verify. */
export type DeviceCertificateProblem = 'malformed' | 'bad-signature'

export type DeviceCertificateCheck =
  | { ok: true; certificate: Signed<DeviceCertificate> }
  | { ok: false; problem: DeviceCertificateProblem }

/**
 * Checks a certificate's shape and that it verifies against the person key it
 * names. The caller must still check that it certifies the claim's device key.
 */
export async function checkDeviceCertificate(
  signed: Signed<unknown>,
): Promise<DeviceCertificateCheck> {
  const { payload } = signed
  if (!isDeviceCertificate(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.personKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, certificate: { payload, signature: signed.signature } }
}

function isDeviceCertificate(payload: unknown): payload is DeviceCertificate {
  const certificate = payload as Partial<DeviceCertificate> | null
  return (
    typeof certificate === 'object' &&
    certificate !== null &&
    certificate.type === DEVICE_CERTIFICATE_TYPE &&
    typeof certificate.personKey === 'string' &&
    typeof certificate.deviceKey === 'string' &&
    typeof certificate.deviceLabel === 'string' &&
    typeof certificate.issuedAt === 'string'
  )
}
