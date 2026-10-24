/**
 * The statements behind host vouching. A guest that lost its keys signs a
 * vouch request with its new device key. Once the operator or a PIN confirms
 * the person, the host signs a vouch, and the guest's claims name it in place
 * of a device certificate.
 *
 * A vouch is only as good as the host that signed it. These checks prove a
 * host key signed it. Whether to trust that host is the caller's decision: a
 * guest compares it with the key its QR link pinned.
 */

import { exportPublicKey, signStatement, verifyStatement } from './signing'
import {
  DEVICE_VOUCH_TYPE,
  VOUCH_REQUEST_TYPE,
  type DeviceVouch,
  type Signed,
  type VouchMethod,
  type VouchRequest,
} from './types'

export async function createVouchRequest(
  details: { personKey: string; deviceLabel: string; requestedAt?: Date },
  deviceKeyPair: CryptoKeyPair,
): Promise<Signed<VouchRequest>> {
  return signStatement(
    {
      type: VOUCH_REQUEST_TYPE,
      deviceKey: await exportPublicKey(deviceKeyPair.publicKey),
      personKey: details.personKey,
      deviceLabel: details.deviceLabel,
      requestedAt: (details.requestedAt ?? new Date()).toISOString(),
    },
    deviceKeyPair.privateKey,
  )
}

/**
 * Signs a vouch for a request. The caller must already have checked the
 * request and had the person confirmed.
 */
export async function createDeviceVouch(
  details: {
    request: VouchRequest
    hostLabel: string
    personName: string
    method: VouchMethod
    firstCertificate: string
    vouchedAt?: Date
  },
  hostKeyPair: CryptoKeyPair,
): Promise<Signed<DeviceVouch>> {
  const { request } = details
  return signStatement(
    {
      type: DEVICE_VOUCH_TYPE,
      hostKey: await exportPublicKey(hostKeyPair.publicKey),
      hostLabel: details.hostLabel,
      personKey: request.personKey,
      personName: details.personName,
      deviceKey: request.deviceKey,
      deviceLabel: request.deviceLabel,
      method: details.method,
      firstCertificate: details.firstCertificate,
      vouchedAt: (details.vouchedAt ?? new Date()).toISOString(),
    },
    hostKeyPair.privateKey,
  )
}

/** Why a vouch request or vouch did not verify. */
export type VouchProblem = 'malformed' | 'bad-signature'

export type VouchRequestCheck =
  | { ok: true; request: Signed<VouchRequest> }
  | { ok: false; problem: VouchProblem }

export type DeviceVouchCheck =
  | { ok: true; vouch: Signed<DeviceVouch> }
  | { ok: false; problem: VouchProblem }

/** Checks a request's shape and that its device key signed it. */
export async function checkVouchRequest(
  signed: Signed<unknown>,
): Promise<VouchRequestCheck> {
  const { payload } = signed
  if (!isVouchRequest(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.deviceKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, request: { payload, signature: signed.signature } }
}

/**
 * Checks a vouch's shape and that the host key it names signed it. The caller
 * must still check that it vouches for the claim's device key.
 */
export async function checkDeviceVouch(
  signed: Signed<unknown>,
): Promise<DeviceVouchCheck> {
  const { payload } = signed
  if (!isDeviceVouch(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.hostKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, vouch: { payload, signature: signed.signature } }
}

const isString = (value: unknown) => typeof value === 'string'

function isVouchRequest(payload: unknown): payload is VouchRequest {
  const request = payload as Partial<VouchRequest> | null
  return (
    typeof request === 'object' &&
    request !== null &&
    request.type === VOUCH_REQUEST_TYPE &&
    isString(request.deviceKey) &&
    isString(request.personKey) &&
    isString(request.deviceLabel) &&
    isString(request.requestedAt)
  )
}

function isDeviceVouch(payload: unknown): payload is DeviceVouch {
  const vouch = payload as Partial<DeviceVouch> | null
  return (
    typeof vouch === 'object' &&
    vouch !== null &&
    vouch.type === DEVICE_VOUCH_TYPE &&
    isString(vouch.hostKey) &&
    isString(vouch.hostLabel) &&
    isString(vouch.personKey) &&
    isString(vouch.personName) &&
    isString(vouch.deviceKey) &&
    isString(vouch.deviceLabel) &&
    (vouch.method === 'operator' || vouch.method === 'pin') &&
    isString(vouch.firstCertificate) &&
    isString(vouch.vouchedAt)
  )
}
