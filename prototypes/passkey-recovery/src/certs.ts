/**
 * THROWAWAY PROTOTYPE (TAP-217). Not production code.
 *
 * Two shapes of device certificate, one per approach, and a verifier both the
 * browser and the host plugin use. Plain WebCrypto, no DOM and no Node APIs.
 *
 * - PRF approach: the passkey unwraps an Ed25519 person key, which signs an
 *   ordinary provenance statement.
 * - Passkey-as-key: the passkey itself signs. The signature is a WebAuthn
 *   assertion over authenticator data and client data, not over our payload.
 */

import {
  canonicalJson,
  fromBase64Url,
  sha256Hex,
  toBase64Url,
  verifyStatement,
  type Signed,
} from './provenance'

export const PROTO_CERT_TYPE = 'proto/device-cert@0'

/** PRF approach. Signed by the unwrapped Ed25519 person key. */
export type Ed25519CertPayload = {
  type: typeof PROTO_CERT_TYPE
  personKey: string
  deviceKey: string
  issuedAt: string
}

/**
 * Passkey-as-key. The payload cannot name the person key. On a new phone the
 * challenge has to be fixed before the person picks a passkey, so the key is
 * only known after the assertion returns. It rides next to the payload instead.
 */
export type PasskeyCertPayload = {
  type: typeof PROTO_CERT_TYPE
  deviceKey: string
  issuedAt: string
  rpId: string
}

export type PasskeyCert = {
  payload: PasskeyCertPayload
  /** SPKI, base64url. Not signed. The signature only verifies under it. */
  personKey: string
  personKeyAlg: PasskeyAlg
  webauthn: {
    credentialId: string
    authenticatorData: string
    clientDataJSON: string
    signature: string
  }
}

export type PasskeyAlg = 'ES256' | 'EdDSA'

export type AnyCert = Signed<Ed25519CertPayload> | PasskeyCert

export function isPasskeyCert(cert: AnyCert): cert is PasskeyCert {
  return 'webauthn' in cert
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** What a passkey-as-key certificate's assertion must sign as its challenge. */
export async function passkeyChallenge(
  payload: PasskeyCertPayload,
): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(canonicalJson(payload)),
  )
  return new Uint8Array(digest)
}

/** A short label for any person key: first 48 bits of its sha-256. */
export async function fingerprint(key: string): Promise<string> {
  const bytes = fromBase64Url(key) ?? encoder.encode(key)
  return (await sha256Hex(bytes)).slice(0, 12).match(/.{4}/g)!.join('-')
}

export type CertCheck =
  | { ok: true; personKey: string; deviceKey: string }
  | { ok: false; reason: string }

export async function verifyCert(cert: AnyCert): Promise<CertCheck> {
  if (cert.payload.type !== PROTO_CERT_TYPE) {
    return { ok: false, reason: 'not a prototype certificate' }
  }
  if (!isPasskeyCert(cert)) {
    const ok = await verifyStatement(cert, cert.payload.personKey)
    return ok
      ? {
          ok: true,
          personKey: cert.payload.personKey,
          deviceKey: cert.payload.deviceKey,
        }
      : { ok: false, reason: 'Ed25519 signature does not verify' }
  }
  const reason = await checkAssertion(cert)
  return reason
    ? { ok: false, reason }
    : {
        ok: true,
        personKey: cert.personKey,
        deviceKey: cert.payload.deviceKey,
      }
}

// The WebAuthn assertion checks a relying party would run, minus the counter.
// Returns a reason on failure.
async function checkAssertion(cert: PasskeyCert): Promise<string | undefined> {
  const { webauthn, payload } = cert
  const clientDataBytes = fromBase64Url(webauthn.clientDataJSON)
  const authData = fromBase64Url(webauthn.authenticatorData)
  const signature = fromBase64Url(webauthn.signature)
  const spki = fromBase64Url(cert.personKey)
  if (!clientDataBytes || !authData || !signature || !spki) {
    return 'malformed base64url'
  }

  let clientData: { type?: string; challenge?: string; origin?: string }
  try {
    clientData = JSON.parse(decoder.decode(clientDataBytes))
  } catch {
    return 'client data is not JSON'
  }
  if (clientData.type !== 'webauthn.get') {
    return `client data type is ${clientData.type}`
  }
  const expected = toBase64Url(await passkeyChallenge(payload))
  if (clientData.challenge !== expected) {
    return 'challenge does not match the certificate payload'
  }
  const originHost = clientData.origin
    ? new URL(clientData.origin).hostname
    : ''
  if (originHost !== payload.rpId && !originHost.endsWith(`.${payload.rpId}`)) {
    return `origin ${clientData.origin} is not under ${payload.rpId}`
  }

  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(payload.rpId)),
  )
  if (authData.length < 37 || !equalBytes(authData.slice(0, 32), rpIdHash)) {
    return 'authenticator data is for another relying party'
  }
  const flags = authData[32]
  if (!(flags & 0x01)) {
    return 'user was not present'
  }
  if (!(flags & 0x04)) {
    return 'user was not verified'
  }

  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', clientDataBytes),
  )
  const signed = concat(authData, clientDataHash)
  try {
    if (cert.personKeyAlg === 'ES256') {
      const key = await crypto.subtle.importKey(
        'spki',
        spki,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      )
      const raw = derToRawEcdsa(signature)
      if (!raw) {
        return 'ES256 signature is not DER'
      }
      const ok = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        raw,
        signed,
      )
      return ok ? undefined : 'ES256 signature does not verify'
    }
    const key = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      signature,
      signed,
    )
    return ok ? undefined : 'EdDSA signature does not verify'
  } catch (error) {
    return `verify threw: ${String(error)}`
  }
}

/**
 * WebAuthn ES256 signatures are DER `SEQUENCE { INTEGER r, INTEGER s }`.
 * WebCrypto wants the 64-byte r||s form. Short-form lengths only, which is
 * all a P-256 signature needs.
 */
export function derToRawEcdsa(
  der: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> | undefined {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) {
    return undefined
  }
  const out = new Uint8Array(64)
  let offset = 2
  for (let part = 0; part < 2; part++) {
    if (der[offset] !== 0x02) {
      return undefined
    }
    const length = der[offset + 1]
    let value = der.slice(offset + 2, offset + 2 + length)
    while (value.length > 32 && value[0] === 0) {
      value = value.slice(1)
    }
    if (value.length > 32) {
      return undefined
    }
    out.set(value, part * 32 + (32 - value.length))
    offset += 2 + length
  }
  return offset === der.length ? out : undefined
}

function concat(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}
