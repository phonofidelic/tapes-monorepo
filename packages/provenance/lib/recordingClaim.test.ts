import { describe, expect, it } from 'vitest'
import {
  createRecordingClaim,
  decodeSignedStatement,
  encodeSignedStatement,
  NO_SESSION_ID,
  parseSignedStatement,
  statementType,
} from './recordingClaim'
import {
  exportPublicKey,
  generateSigningKeyPair,
  statementBytes,
  verifyStatement,
} from './signing'
import { toBase64Url } from './encoding'
import { RECORDING_CLAIM_TYPE } from './types'

const details = {
  blob: { hash: 'ab'.repeat(32), size: 1024, mimeType: 'audio/mp4' },
  startedAt: '2026-10-05T12:00:00.000Z',
  endedAt: '2026-10-05T12:03:00.000Z',
}

describe('createRecordingClaim', () => {
  it('signs a claim naming the device key', async () => {
    const keyPair = await generateSigningKeyPair()
    const signed = await createRecordingClaim(details, keyPair)

    expect(signed.payload).toEqual({
      type: RECORDING_CLAIM_TYPE,
      ...details,
      sessionId: NO_SESSION_ID,
      deviceKey: await exportPublicKey(keyPair.publicKey),
    })
    expect(await verifyStatement(signed, keyPair.publicKey)).toBe(true)
    expect(await verifyStatement(signed, signed.payload.deviceKey)).toBe(true)
  })

  it('uses the session ID when given one', async () => {
    const keyPair = await generateSigningKeyPair()
    const signed = await createRecordingClaim(
      { ...details, sessionId: 'session-1' },
      keyPair,
    )
    expect(signed.payload.sessionId).toBe('session-1')
  })

  it('names the device certificate when given one', async () => {
    const keyPair = await generateSigningKeyPair()
    const signed = await createRecordingClaim(
      { ...details, deviceCert: 'cd'.repeat(32) },
      keyPair,
    )
    expect(signed.payload.deviceCert).toBe('cd'.repeat(32))
    expect(await verifyStatement(signed, keyPair.publicKey)).toBe(true)
  })

  it('leaves the certificate out when there is none', async () => {
    const keyPair = await generateSigningKeyPair()
    const signed = await createRecordingClaim(details, keyPair)
    expect('deviceCert' in signed.payload).toBe(false)
  })
})

describe('encodeSignedStatement', () => {
  it('round-trips a signed claim that still verifies', async () => {
    const keyPair = await generateSigningKeyPair()
    const signed = await createRecordingClaim(details, keyPair)

    const text = encodeSignedStatement(signed)
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/)

    const decoded = decodeSignedStatement(text)
    expect(decoded).toEqual(signed)
    expect(await verifyStatement(decoded!, keyPair.publicKey)).toBe(true)
  })

  it('rejects text that is not a statement wrapper', () => {
    const encode = (value: string) =>
      toBase64Url(new TextEncoder().encode(value))

    expect(decodeSignedStatement('not base64url!')).toBeUndefined()
    expect(decodeSignedStatement(encode('not json'))).toBeUndefined()
    expect(decodeSignedStatement(encode('null'))).toBeUndefined()
    expect(decodeSignedStatement(encode('[]'))).toBeUndefined()
    expect(decodeSignedStatement(encode('{"payload":{}}'))).toBeUndefined()
    expect(decodeSignedStatement(encode('{"signature":"abc"}'))).toBeUndefined()
    expect(decodeSignedStatement(toBase64Url(new Uint8Array([0xff])))).toBe(
      undefined,
    )
  })
})

describe('parseSignedStatement', () => {
  it('reads a statement from its stored bytes', async () => {
    const claim = await createRecordingClaim(
      details,
      await generateSigningKeyPair(),
    )

    expect(parseSignedStatement(statementBytes(claim))).toEqual(claim)
  })

  it('rejects bytes that are not a statement wrapper', () => {
    const bytes = (value: string) => new TextEncoder().encode(value)

    expect(parseSignedStatement(bytes('not json'))).toBeUndefined()
    expect(parseSignedStatement(bytes('[]'))).toBeUndefined()
    expect(parseSignedStatement(bytes('{"payload":{}}'))).toBeUndefined()
    expect(parseSignedStatement(new Uint8Array([0xff]))).toBeUndefined()
  })
})

describe('statementType', () => {
  it('reads the payload type, if the payload is an object', () => {
    expect(statementType({ payload: { type: 'x' }, signature: '' })).toBe('x')
    expect(statementType({ payload: null, signature: '' })).toBeUndefined()
  })
})
