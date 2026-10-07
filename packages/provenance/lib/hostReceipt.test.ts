import { describe, expect, it } from 'vitest'
import { checkRecordingClaim, createHostReceipt } from './hostReceipt'
import { createRecordingClaim } from './recordingClaim'
import {
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
  verifyStatement,
} from './signing'
import { HOST_RECEIPT_TYPE } from './types'

const received = { hash: 'ab'.repeat(32), size: 1024 }

async function signedClaim() {
  return createRecordingClaim(
    {
      blob: { ...received, mimeType: 'audio/mp4' },
      startedAt: '2026-10-05T12:00:00.000Z',
      endedAt: '2026-10-05T12:03:00.000Z',
    },
    await generateSigningKeyPair(),
  )
}

describe('checkRecordingClaim', () => {
  it('accepts a claim over the bytes the host received', async () => {
    const claim = await signedClaim()

    expect(await checkRecordingClaim(claim, received)).toEqual({
      ok: true,
      claim,
    })
  })

  it('rejects a claim over different bytes', async () => {
    const claim = await signedClaim()

    expect(
      await checkRecordingClaim(claim, { ...received, hash: 'cd'.repeat(32) }),
    ).toEqual({ ok: false, problem: 'hash-mismatch' })
  })

  it('rejects a claim with the wrong size', async () => {
    const claim = await signedClaim()

    expect(
      await checkRecordingClaim(claim, { ...received, size: 1023 }),
    ).toEqual({ ok: false, problem: 'size-mismatch' })
  })

  it('rejects a claim whose payload was changed after signing', async () => {
    const claim = await signedClaim()
    const tampered = {
      ...claim,
      payload: { ...claim.payload, startedAt: '2020-01-01T00:00:00.000Z' },
    }

    expect(await checkRecordingClaim(tampered, received)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })

  it('rejects a claim signed by a key other than the one it names', async () => {
    const claim = await signedClaim()
    const other = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )
    const swapped = {
      ...claim,
      payload: { ...claim.payload, deviceKey: other },
    }

    expect(await checkRecordingClaim(swapped, received)).toEqual({
      ok: false,
      problem: 'bad-signature',
    })
  })

  it.each([
    ['null', null],
    ['another statement type', { type: 'tapes/receipt@1' }],
    ['a claim with no blob', { type: 'tapes/recording@1', deviceKey: 'x' }],
  ])('rejects %s as malformed', async (_, payload) => {
    expect(
      await checkRecordingClaim({ payload, signature: 'sig' }, received),
    ).toEqual({ ok: false, problem: 'malformed' })
  })
})

describe('createHostReceipt', () => {
  it('signs the claim address with the host clock and key', async () => {
    const claim = await signedClaim()
    const host = await generateSigningKeyPair()
    const receivedAt = new Date('2026-10-06T09:00:00.000Z')

    const receipt = await createHostReceipt(claim, host, receivedAt)

    expect(receipt.payload).toEqual({
      type: HOST_RECEIPT_TYPE,
      claim: await statementAddress(claim),
      receivedAt: '2026-10-06T09:00:00.000Z',
      hostKey: await exportPublicKey(host.publicKey),
    })
    expect(await verifyStatement(receipt, host.publicKey)).toBe(true)
  })
})
