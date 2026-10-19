/**
 * THROWAWAY PROTOTYPE (TAP-217). Checks the certificate verifier with a fake
 * authenticator built from WebCrypto. It proves the verifier logic only. It
 * says nothing about what real phones and password managers do.
 */

import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  exportPublicKey,
  generateSigningKeyPair,
  signStatement,
  toBase64Url,
} from './src/provenance'
import {
  PROTO_CERT_TYPE,
  derToRawEcdsa,
  passkeyChallenge,
  verifyCert,
  type Ed25519CertPayload,
  type PasskeyCert,
  type PasskeyCertPayload,
} from './src/certs'

const encoder = new TextEncoder()
const RP = 'tapes-proto.example.com'

// Raw r||s to DER, as an authenticator returns ES256 signatures.
function rawToDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const int = (bytes: Uint8Array) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let value = Array.from(bytes.slice(start))
    if (value[0] & 0x80) value = [0, ...value]
    return [0x02, value.length, ...value]
  }
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))]
  return new Uint8Array([0x30, body.length, ...body])
}

async function fakeAssertion(
  payload: PasskeyCertPayload,
  alg: 'ES256' | 'EdDSA',
  options: { origin?: string; flags?: number } = {},
): Promise<PasskeyCert> {
  const keyPair = (
    alg === 'ES256'
      ? await crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['sign', 'verify'],
        )
      : await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
          'sign',
          'verify',
        ])
  ) as CryptoKeyPair
  const spki = new Uint8Array(
    await crypto.subtle.exportKey('spki', keyPair.publicKey),
  )
  const clientData = encoder.encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: toBase64Url(await passkeyChallenge(payload)),
      origin: options.origin ?? `https://${RP}`,
    }),
  )
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(payload.rpId)),
  )
  const authData = new Uint8Array(37)
  authData.set(rpIdHash)
  authData[32] = options.flags ?? 0x05
  const clientHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', clientData),
  )
  const signed = new Uint8Array([...authData, ...clientHash])
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      alg === 'ES256'
        ? { name: 'ECDSA', hash: 'SHA-256' }
        : { name: 'Ed25519' },
      keyPair.privateKey,
      signed,
    ),
  )
  return {
    payload,
    personKey: toBase64Url(spki),
    personKeyAlg: alg,
    webauthn: {
      credentialId: 'test',
      authenticatorData: toBase64Url(authData),
      clientDataJSON: toBase64Url(clientData),
      signature: toBase64Url(alg === 'ES256' ? rawToDer(raw) : raw),
    },
  }
}

const payload = (): PasskeyCertPayload => ({
  type: PROTO_CERT_TYPE,
  deviceKey: 'device-key',
  issuedAt: '2026-10-19T00:00:00.000Z',
  rpId: RP,
})

describe('prototype device certificates', () => {
  it('accepts a PRF-style Ed25519 certificate', async () => {
    const person = await generateSigningKeyPair()
    const cert = await signStatement<Ed25519CertPayload>(
      {
        type: PROTO_CERT_TYPE,
        personKey: await exportPublicKey(person.publicKey),
        deviceKey: 'device-key',
        issuedAt: '2026-10-19T00:00:00.000Z',
      },
      person.privateKey,
    )
    expect(await verifyCert(cert)).toMatchObject({ ok: true })
  })

  it.each(['ES256', 'EdDSA'] as const)(
    'accepts a %s passkey assertion',
    async (alg) => {
      expect(
        await verifyCert(await fakeAssertion(payload(), alg)),
      ).toMatchObject({
        ok: true,
      })
    },
  )

  it('rejects an assertion for another device key', async () => {
    const cert = await fakeAssertion(payload(), 'ES256')
    cert.payload = { ...cert.payload, deviceKey: 'other' }
    expect(await verifyCert(cert)).toMatchObject({ ok: false })
  })

  it('rejects an assertion from another origin', async () => {
    const cert = await fakeAssertion(payload(), 'ES256', {
      origin: 'https://evil.example.net',
    })
    expect(await verifyCert(cert)).toMatchObject({ ok: false })
  })

  it('rejects an assertion without user verification', async () => {
    const cert = await fakeAssertion(payload(), 'ES256', { flags: 0x01 })
    expect(await verifyCert(cert)).toMatchObject({ ok: false })
  })

  it('round-trips DER signatures', () => {
    const raw = new Uint8Array(64).map((_, i) =>
      i === 0 || i === 32 ? 0x80 : i,
    )
    expect(derToRawEcdsa(rawToDer(raw))).toEqual(raw)
    expect(canonicalJson(payload())).toContain(RP)
  })
})
