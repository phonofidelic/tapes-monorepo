import { describe, expect, it } from 'vitest'
import {
  createRecordingClaim,
  decodeSignedStatement,
  encodeSignedStatement,
  NO_SESSION_ID,
} from './recordingClaim'
import {
  exportPublicKey,
  generateSigningKeyPair,
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
