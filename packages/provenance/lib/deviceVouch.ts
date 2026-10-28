/**
 * The statements behind host vouching. A person joins a host's roster with a
 * join request signed by their person key. A guest that later lost its keys
 * signs a vouch request with its new device key. Once the operator or a PIN
 * confirms the person, the host signs a vouch, and the guest's claims name it
 * in place of a device certificate.
 *
 * A vouch is only as good as the host that signed it. These checks prove a
 * host key signed it. Whether to trust that host is the caller's decision: a
 * guest compares it with the key its QR link pinned.
 */

import { checkDeviceCertificate } from './deviceCertificate'
import { statementType } from './recordingClaim'
import { exportPublicKey, signStatement, verifyStatement } from './signing'
import {
  DEVICE_CERTIFICATE_TYPE,
  DEVICE_VOUCH_TYPE,
  type DeviceCertificate,
  JOIN_REQUEST_TYPE,
  VOUCH_REQUEST_TYPE,
  type DeviceVouch,
  type JoinRequest,
  type Signed,
  type VouchMethod,
  type VouchRequest,
} from './types'

export async function createJoinRequest(
  details: { personName: string; certificate: string; challenge: string },
  personKeyPair: CryptoKeyPair,
): Promise<Signed<JoinRequest>> {
  return signStatement(
    {
      type: JOIN_REQUEST_TYPE,
      personKey: await exportPublicKey(personKeyPair.publicKey),
      personName: details.personName,
      certificate: details.certificate,
      challenge: details.challenge,
    },
    personKeyPair.privateKey,
  )
}

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

/** Why a join request, vouch request or vouch did not verify. */
export type VouchProblem = 'malformed' | 'bad-signature'

export type JoinRequestCheck =
  | { ok: true; request: Signed<JoinRequest> }
  | { ok: false; problem: VouchProblem }

export type VouchRequestCheck =
  | { ok: true; request: Signed<VouchRequest> }
  | { ok: false; problem: VouchProblem }

export type DeviceVouchCheck =
  | { ok: true; vouch: Signed<DeviceVouch> }
  | { ok: false; problem: VouchProblem }

/**
 * Checks a join request's shape and that its person key signed it. The caller
 * must still consume its challenge and check the certificate it names.
 */
export async function checkJoinRequest(
  signed: Signed<unknown>,
): Promise<JoinRequestCheck> {
  const { payload } = signed
  if (!isJoinRequest(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.personKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, request: { payload, signature: signed.signature } }
}

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

/** What a claim's `deviceCert` can name: a certificate or a vouch. */
export type DeviceLink = DeviceCertificate | DeviceVouch

export type DeviceLinkCheck =
  | { ok: true; link: Signed<DeviceLink> }
  | { ok: false; problem: VouchProblem | 'unknown-type' }

/**
 * Checks a certificate or a vouch, whichever the statement is. The caller must
 * still check that it is for the claim's device key.
 */
export async function checkDeviceLink(
  signed: Signed<unknown>,
): Promise<DeviceLinkCheck> {
  const type = statementType(signed)
  if (type === DEVICE_CERTIFICATE_TYPE) {
    const check = await checkDeviceCertificate(signed)
    return check.ok
      ? { ok: true, link: check.certificate }
      : { ok: false, problem: check.problem }
  }
  if (type === DEVICE_VOUCH_TYPE) {
    const check = await checkDeviceVouch(signed)
    return check.ok
      ? { ok: true, link: check.vouch }
      : { ok: false, problem: check.problem }
  }
  return { ok: false, problem: 'unknown-type' }
}

const isString = (value: unknown) => typeof value === 'string'

function isJoinRequest(payload: unknown): payload is JoinRequest {
  const request = payload as Partial<JoinRequest> | null
  return (
    typeof request === 'object' &&
    request !== null &&
    request.type === JOIN_REQUEST_TYPE &&
    isString(request.personKey) &&
    isString(request.personName) &&
    isString(request.certificate) &&
    isString(request.challenge)
  )
}

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
