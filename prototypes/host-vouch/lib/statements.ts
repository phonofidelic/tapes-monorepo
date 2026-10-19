/**
 * THROWAWAY PROTOTYPE (TAP-219). Not production code. Do not import from apps
 * or packages.
 *
 * The statements behind host vouching: a person-signed device certificate, a
 * device's signed request to be vouched for, and the host-signed vouch itself.
 * Signing and canonical JSON come from the provenance package. This file must
 * stay browser-safe, because the prototype server also serves it to guests.
 */

import {
  exportPublicKey,
  signStatement,
  statementAddress,
  verifyStatement,
  type Signed,
} from '@tapes-monorepo/provenance'

// The `tapes-proto/` prefix and `@0` keep these apart from real statement
// types. Nothing outside the prototype should ever accept them.
export const PERSON_CERT_TYPE = 'tapes-proto/device-cert@0'
export const VOUCH_REQUEST_TYPE = 'tapes-proto/vouch-request@0'
export const DEVICE_VOUCH_TYPE = 'tapes-proto/device-vouch@0'

/**
 * Signed by the person key. A stand-in for the device certificate that person
 * keys will issue, so the prototype has something for a vouch to point back to.
 */
export type PersonCertificate = {
  type: typeof PERSON_CERT_TYPE
  personKey: string
  deviceKey: string
  deviceLabel?: string
  issuedAt: string
}

/**
 * Signed by the new device key. It shows the host that the requester holds the
 * key it wants vouched for. The person it names is only a claim until the
 * operator or a PIN confirms it.
 */
export type VouchRequest = {
  type: typeof VOUCH_REQUEST_TYPE
  deviceKey: string
  personKey: string
  deviceLabel?: string
  requestedAt: string
}

/** How the person showed the host it was them. */
export type VouchMethod = 'operator' | 'pin'

/**
 * Signed by the host key. It says: this host saw the person who holds
 * `personKey` take up `deviceKey`. The host is a witness. It never holds the
 * person key, so it cannot issue a person certificate.
 */
export type DeviceVouch = {
  type: typeof DEVICE_VOUCH_TYPE
  deviceKey: string
  personKey: string
  /** The name this host knows the person by. Unverified, like device labels. */
  personName: string
  deviceLabel?: string
  method: VouchMethod
  /**
   * Address of the person certificate that first introduced this person to
   * the host. It ties the vouch back to something the person key signed.
   */
  basis: string
  /** The host's clock. */
  vouchedAt: string
  hostKey: string
}

export async function createPersonCertificate(
  details: { deviceKey: string; deviceLabel?: string; issuedAt: Date },
  personKeyPair: CryptoKeyPair,
): Promise<Signed<PersonCertificate>> {
  return signStatement(
    {
      type: PERSON_CERT_TYPE,
      personKey: await exportPublicKey(personKeyPair.publicKey),
      deviceKey: details.deviceKey,
      deviceLabel: details.deviceLabel,
      issuedAt: details.issuedAt.toISOString(),
    },
    personKeyPair.privateKey,
  )
}

export async function createVouchRequest(
  details: { personKey: string; deviceLabel?: string; requestedAt: Date },
  deviceKeyPair: CryptoKeyPair,
): Promise<Signed<VouchRequest>> {
  return signStatement(
    {
      type: VOUCH_REQUEST_TYPE,
      deviceKey: await exportPublicKey(deviceKeyPair.publicKey),
      personKey: details.personKey,
      deviceLabel: details.deviceLabel,
      requestedAt: details.requestedAt.toISOString(),
    },
    deviceKeyPair.privateKey,
  )
}

/**
 * Signs a vouch. The caller must already have checked the request and had the
 * person confirmed by the operator or a PIN.
 */
export async function createDeviceVouch(
  details: {
    request: VouchRequest
    personName: string
    method: VouchMethod
    basis: string
    vouchedAt: Date
  },
  hostKeyPair: CryptoKeyPair,
): Promise<Signed<DeviceVouch>> {
  const { request } = details
  return signStatement(
    {
      type: DEVICE_VOUCH_TYPE,
      deviceKey: request.deviceKey,
      personKey: request.personKey,
      personName: details.personName,
      deviceLabel: request.deviceLabel,
      method: details.method,
      basis: details.basis,
      vouchedAt: details.vouchedAt.toISOString(),
      hostKey: await exportPublicKey(hostKeyPair.publicKey),
    },
    hostKeyPair.privateKey,
  )
}

export type StatementProblem = 'malformed' | 'bad-signature'
export type VouchProblem = StatementProblem | 'untrusted-host'

export type Check<T> =
  { ok: true; statement: Signed<T> } | { ok: false; problem: VouchProblem }

const isString = (value: unknown) => typeof value === 'string'
const isOptionalString = (value: unknown) =>
  value === undefined || typeof value === 'string'

function isPersonCertificate(value: unknown): value is PersonCertificate {
  const cert = value as Partial<PersonCertificate> | null
  return (
    typeof cert === 'object' &&
    cert !== null &&
    cert.type === PERSON_CERT_TYPE &&
    isString(cert.personKey) &&
    isString(cert.deviceKey) &&
    isOptionalString(cert.deviceLabel) &&
    isString(cert.issuedAt)
  )
}

function isVouchRequest(value: unknown): value is VouchRequest {
  const request = value as Partial<VouchRequest> | null
  return (
    typeof request === 'object' &&
    request !== null &&
    request.type === VOUCH_REQUEST_TYPE &&
    isString(request.deviceKey) &&
    isString(request.personKey) &&
    isOptionalString(request.deviceLabel) &&
    isString(request.requestedAt)
  )
}

function isDeviceVouch(value: unknown): value is DeviceVouch {
  const vouch = value as Partial<DeviceVouch> | null
  return (
    typeof vouch === 'object' &&
    vouch !== null &&
    vouch.type === DEVICE_VOUCH_TYPE &&
    isString(vouch.deviceKey) &&
    isString(vouch.personKey) &&
    isString(vouch.personName) &&
    isOptionalString(vouch.deviceLabel) &&
    (vouch.method === 'operator' || vouch.method === 'pin') &&
    isString(vouch.basis) &&
    isString(vouch.vouchedAt) &&
    isString(vouch.hostKey)
  )
}

/** Checks a certificate against the person key it names. */
export async function checkPersonCertificate(
  signed: Signed<unknown>,
): Promise<Check<PersonCertificate>> {
  const { payload } = signed
  if (!isPersonCertificate(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.personKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, statement: { payload, signature: signed.signature } }
}

/** Checks a request against the device key it names. */
export async function checkVouchRequest(
  signed: Signed<unknown>,
): Promise<Check<VouchRequest>> {
  const { payload } = signed
  if (!isVouchRequest(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.deviceKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  return { ok: true, statement: { payload, signature: signed.signature } }
}

/**
 * Checks a vouch's shape and signature. A vouch is only as good as the host
 * that signed it, so the caller passes the host keys it trusts. A guest pins
 * the key from the QR code. Passing no list skips the host check, which only
 * proves some key signed it.
 */
export async function checkDeviceVouch(
  signed: Signed<unknown>,
  trustedHostKeys?: readonly string[],
): Promise<Check<DeviceVouch>> {
  const { payload } = signed
  if (!isDeviceVouch(payload)) {
    return { ok: false, problem: 'malformed' }
  }
  if (!(await verifyStatement(signed, payload.hostKey))) {
    return { ok: false, problem: 'bad-signature' }
  }
  if (trustedHostKeys && !trustedHostKeys.includes(payload.hostKey)) {
    return { ok: false, problem: 'untrusted-host' }
  }
  return { ok: true, statement: { payload, signature: signed.signature } }
}

/**
 * How strongly a device is tied to a person, from strongest to weakest.
 * `other-host` is a vouch from a host this verifier does not trust. It is
 * shown with that host's name, never as plain "Sam".
 */
export type DeviceLink =
  | { personKey: string; via: 'person-key' }
  | {
      personKey: string
      via: 'trusted-host' | 'other-host'
      hostKey: string
      method: VouchMethod
    }

/**
 * Who a device belongs to, from the statement a recording claim's
 * `deviceCert` points at. Returns undefined when the statement does not verify
 * or names a different device.
 *
 * This is the rule proposed for a second host: it keeps a first host's vouch
 * and shows it, labelled with that host, but does not count it as the person's
 * own signature.
 */
export async function resolveDeviceLink(
  signed: Signed<unknown>,
  deviceKey: string,
  trustedHostKeys: readonly string[],
): Promise<DeviceLink | undefined> {
  const cert = await checkPersonCertificate(signed)
  if (cert.ok) {
    return cert.statement.payload.deviceKey === deviceKey
      ? { personKey: cert.statement.payload.personKey, via: 'person-key' }
      : undefined
  }
  const vouch = await checkDeviceVouch(signed)
  if (!vouch.ok || vouch.statement.payload.deviceKey !== deviceKey) {
    return undefined
  }
  const { personKey, hostKey, method } = vouch.statement.payload
  return {
    personKey,
    via: trustedHostKeys.includes(hostKey) ? 'trusted-host' : 'other-host',
    hostKey,
    method,
  }
}

export { statementAddress }
