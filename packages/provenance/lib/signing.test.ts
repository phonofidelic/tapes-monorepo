import { describe, expect, it } from 'vitest'
import {
  exportPublicKey,
  generateSigningKeyPair,
  importPublicKey,
  signStatement,
  statementAddress,
  statementBytes,
  verifyStatement,
} from './signing'
import { fromBase64Url, sha256Hex, toBase64Url } from './encoding'
import { RECORDING_CLAIM_TYPE, type RecordingClaim } from './types'

const hex = (text: string) =>
  new Uint8Array(text.match(/../g)!.map((pair) => parseInt(pair, 16)))

// RFC 8032 section 7.1, test 1. WebCrypto only imports Ed25519 private keys
// as PKCS #8, so the seed gets the fixed PKCS #8 prefix for Ed25519.
const RFC_SEED =
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
const RFC_PUBLIC_KEY = toBase64Url(
  hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'),
)

const importRfcPrivateKey = () =>
  crypto.subtle.importKey(
    'pkcs8',
    hex('302e020100300506032b657004220420' + RFC_SEED),
    { name: 'Ed25519' },
    false,
    ['sign'],
  )

const claim = (deviceKey: string): RecordingClaim => ({
  type: RECORDING_CLAIM_TYPE,
  blob: { hash: 'ab'.repeat(32), size: 1024, mimeType: 'audio/webm' },
  startedAt: '2026-10-05T12:00:00.000Z',
  endedAt: '2026-10-05T12:03:00.000Z',
  sessionId: 'session-1',
  deviceKey,
})

describe('signStatement and verifyStatement', () => {
  it('verifies a statement signed with the matching key', async () => {
    const keys = await generateSigningKeyPair()
    const publicKey = await exportPublicKey(keys.publicKey)
    const signed = await signStatement(claim(publicKey), keys.privateKey)

    expect(await verifyStatement(signed, keys.publicKey)).toBe(true)
    expect(await verifyStatement(signed, publicKey)).toBe(true)
  })

  // The payload may have passed through JSON.parse on another device, which
  // keeps whatever key order the sender used.
  it('ignores key order in the payload', async () => {
    const keys = await generateSigningKeyPair()
    const signed = await signStatement(claim('k'), keys.privateKey)
    const reordered = Object.fromEntries(
      Object.entries(signed.payload).reverse(),
    )

    expect(
      await verifyStatement({ ...signed, payload: reordered }, keys.publicKey),
    ).toBe(true)
  })

  it('rejects a changed payload', async () => {
    const keys = await generateSigningKeyPair()
    const signed = await signStatement(claim('k'), keys.privateKey)
    const payload = { ...signed.payload, endedAt: '2026-10-05T13:00:00.000Z' }

    expect(await verifyStatement({ ...signed, payload }, keys.publicKey)).toBe(
      false,
    )
  })

  it('rejects another key', async () => {
    const keys = await generateSigningKeyPair()
    const other = await generateSigningKeyPair()
    const signed = await signStatement(claim('k'), keys.privateKey)

    expect(await verifyStatement(signed, other.publicKey)).toBe(false)
  })

  it.each([
    ['a malformed signature', { signature: '!!' }],
    ['a short signature', { signature: 'AAAA' }],
    ['a payload that cannot be canonicalized', { payload: NaN }],
  ])('returns false for %s', async (_, change) => {
    const keys = await generateSigningKeyPair()
    const signed = await signStatement(claim('k'), keys.privateKey)

    expect(
      await verifyStatement({ ...signed, ...change }, keys.publicKey),
    ).toBe(false)
  })

  it.each([
    ['not base64url', '!!'],
    ['the wrong length', 'AAAA'],
  ])('returns false for a key that is %s', async (_, publicKey) => {
    const keys = await generateSigningKeyPair()
    const signed = await signStatement(claim('k'), keys.privateKey)

    expect(await verifyStatement(signed, publicKey)).toBe(false)
  })
})

describe('importPublicKey and exportPublicKey', () => {
  it('round-trips a public key as 32 base64url bytes', async () => {
    const keys = await generateSigningKeyPair()
    const text = await exportPublicKey(keys.publicKey)
    const imported = await importPublicKey(text)

    expect(fromBase64Url(text)).toHaveLength(32)
    expect(await exportPublicKey(imported!)).toBe(text)
  })

  it('keeps a generated private key unextractable by default', async () => {
    const keys = await generateSigningKeyPair()

    expect(keys.privateKey.extractable).toBe(false)
  })
})

// Fixed key and payload, so any change to the canonical form, the signature
// encoding or the address shows up here. Devices running different builds
// must agree on all three.
describe('known values', () => {
  it('signs with the private half of the RFC 8032 key', async () => {
    const privateKey = await importRfcPrivateKey()
    const signed = await signStatement(claim(RFC_PUBLIC_KEY), privateKey)

    expect(await verifyStatement(signed, RFC_PUBLIC_KEY)).toBe(true)
  })

  it('produces a stable signature and address', async () => {
    const privateKey = await importRfcPrivateKey()
    const signed = await signStatement(claim(RFC_PUBLIC_KEY), privateKey)

    expect(signed.signature).toMatchInlineSnapshot(
      `"U_i1IWLsqpjt589SzzHvbZKKqZePxfqlvwy-P9G5LpacKReo1jPZhOcaDMIuXcNBfEK8dlxxGy7y92fBSZnXDw"`,
    )
    expect(await statementAddress(signed)).toMatchInlineSnapshot(
      `"9dd32a4d018c6eac05a313642c5576986b0da20410fe67cb144ad6bf0ab13ea0"`,
    )
  })
})

describe('statementAddress', () => {
  it('changes when the signature changes', async () => {
    const keys = await generateSigningKeyPair()
    const signed = await signStatement(claim('k'), keys.privateKey)
    const forged = { ...signed, signature: 'A'.repeat(86) }

    expect(await statementAddress(signed)).toMatch(/^[0-9a-f]{64}$/)
    expect(await statementAddress(forged)).not.toBe(
      await statementAddress(signed),
    )
  })
})

describe('statementBytes', () => {
  // A content-addressed store files the statement under the hash of these
  // bytes, so that hash has to be the statement's address.
  it('hashes to the statement address', async () => {
    const keys = await generateSigningKeyPair()
    const signed = await signStatement(claim('k'), keys.privateKey)

    expect(await sha256Hex(statementBytes(signed))).toBe(
      await statementAddress(signed),
    )
  })
})
