import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonicalJson'
import { sha256Hex } from './encoding'
import { createHostReceipt } from './hostReceipt'
import { createRecordingClaim, NO_SESSION_ID } from './recordingClaim'
import {
  verifyRecordingStatements,
  type FetchedStatement,
} from './recordingProvenance'
import {
  exportPublicKey,
  generateSigningKeyPair,
  signStatement,
  statementAddress,
  statementBytes,
} from './signing'
import type { Signed } from './types'

const blob = { hash: 'ab'.repeat(32), size: 1024 }

const deviceKeys = await generateSigningKeyPair()
const hostKeys = await generateSigningKeyPair()
const deviceKey = await exportPublicKey(deviceKeys.publicKey)

function signedClaim(audio = blob) {
  return createRecordingClaim(
    {
      blob: { ...audio, mimeType: 'audio/mp4' },
      startedAt: '2026-10-05T12:00:00.000Z',
      endedAt: '2026-10-05T12:03:00.000Z',
      sessionId: 'session-1',
    },
    deviceKeys,
  )
}

function receiptFor(
  claim: Signed<unknown>,
  receivedAt = '2026-10-05T12:03:02.000Z',
  keys = hostKeys,
) {
  return createHostReceipt(
    claim as Parameters<typeof createHostReceipt>[0],
    keys,
    new Date(receivedAt),
  )
}

async function fetched(signed: Signed<unknown>): Promise<FetchedStatement> {
  return { hash: await statementAddress(signed), bytes: statementBytes(signed) }
}

const verify = async (...statements: Promise<FetchedStatement>[]) =>
  verifyRecordingStatements(blob, await Promise.all(statements))

describe('verifyRecordingStatements', () => {
  it('is verified when a claim and its receipt pass', async () => {
    const claim = await signedClaim()

    expect(
      await verify(fetched(claim), fetched(await receiptFor(claim))),
    ).toEqual({
      state: 'verified',
      deviceKey,
      startedAt: '2026-10-05T12:00:00.000Z',
      endedAt: '2026-10-05T12:03:00.000Z',
      sessionId: 'session-1',
      receivedAt: '2026-10-05T12:03:02.000Z',
      recordedByHost: false,
    })
  })

  it('marks a receipt the device signed for itself', async () => {
    const claim = await signedClaim()
    const selfReceipt = await receiptFor(claim, undefined, deviceKeys)

    expect(await verify(fetched(claim), fetched(selfReceipt))).toMatchObject({
      state: 'verified',
      recordedByHost: true,
    })
  })

  it('shows the earliest of several receipts for one claim', async () => {
    const claim = await signedClaim()
    const retry = await receiptFor(claim, '2026-10-05T12:09:00.000Z')
    const first = await receiptFor(claim, '2026-10-05T12:03:02.000Z')

    expect(
      await verify(fetched(claim), fetched(retry), fetched(first)),
    ).toMatchObject({
      state: 'verified',
      receivedAt: '2026-10-05T12:03:02.000Z',
    })
  })

  it('skips a statement type it does not know', async () => {
    const claim = await signedClaim()
    const future = await signStatement(
      { type: 'tapes/something@1', note: 'from a later version' },
      deviceKeys.privateKey,
    )

    expect(
      await verify(
        fetched(claim),
        fetched(await receiptFor(claim)),
        fetched(future),
      ),
    ).toMatchObject({ state: 'verified' })
  })

  it('is signed on device only when no receipt names the claim', async () => {
    const claim = await signedClaim()

    expect(await verify(fetched(claim))).toEqual({
      state: 'device-only',
      deviceKey,
      startedAt: '2026-10-05T12:00:00.000Z',
      endedAt: '2026-10-05T12:03:00.000Z',
      sessionId: 'session-1',
    })
  })

  it('passes an unsessioned claim through for the view to hide', async () => {
    const claim = await createRecordingClaim(
      {
        blob: { ...blob, mimeType: 'audio/mp4' },
        startedAt: 'a',
        endedAt: 'b',
      },
      deviceKeys,
    )

    expect(await verify(fetched(claim))).toMatchObject({
      sessionId: NO_SESSION_ID,
    })
  })

  it('is unverified with no statements', async () => {
    expect(await verify()).toEqual({ state: 'unverified' })
  })

  it('is unverified when every statement is of an unknown type', async () => {
    const future = await signStatement(
      { type: 'tapes/something@1' },
      deviceKeys.privateKey,
    )

    expect(await verify(fetched(future))).toEqual({ state: 'unverified' })
  })

  it('fails a claim about other audio', async () => {
    const other = await signedClaim({ hash: 'cd'.repeat(32), size: 1024 })
    const hash = await statementAddress(other)

    expect(await verify(fetched(other))).toEqual({
      state: 'failed',
      failures: [{ hash, problem: 'hash-mismatch' }],
    })
  })

  it('fails when a claim about other audio sits beside a good one', async () => {
    const claim = await signedClaim()
    const other = await signedClaim({ ...blob, size: 2048 })

    expect(
      await verify(
        fetched(claim),
        fetched(await receiptFor(claim)),
        fetched(other),
      ),
    ).toEqual({
      state: 'failed',
      failures: [
        { hash: await statementAddress(other), problem: 'size-mismatch' },
      ],
    })
  })

  it('fails a receipt that names no listed claim', async () => {
    const claim = await signedClaim()
    const unlisted = await signedClaim({ hash: 'cd'.repeat(32), size: 1 })
    const stray = await receiptFor(unlisted)

    expect(await verify(fetched(claim), fetched(stray))).toEqual({
      state: 'failed',
      failures: [
        { hash: await statementAddress(stray), problem: 'claim-not-listed' },
      ],
    })
  })

  it('fails a receipt whose signature does not verify', async () => {
    const claim = await signedClaim()
    const receipt = await receiptFor(claim)
    const tampered = {
      ...receipt,
      payload: { ...receipt.payload, receivedAt: '2020-01-01T00:00:00.000Z' },
    }

    expect(await verify(fetched(claim), fetched(tampered))).toMatchObject({
      state: 'failed',
      failures: [{ problem: 'bad-signature' }],
    })
  })

  it('fails bytes that do not hash to the listed address', async () => {
    const claim = await signedClaim()
    const listed = await statementAddress(claim)
    const bytes = statementBytes(await signedClaim({ ...blob, size: 1 }))

    expect(
      await verifyRecordingStatements(blob, [{ hash: listed, bytes }]),
    ).toEqual({
      state: 'failed',
      failures: [{ hash: listed, problem: 'address-mismatch' }],
    })
  })

  it('fails a statement that is not in canonical form', async () => {
    const claim = await signedClaim()
    const bytes = new TextEncoder().encode(JSON.stringify(claim, null, 2))
    const hash = await sha256Hex(bytes)

    expect(await verifyRecordingStatements(blob, [{ hash, bytes }])).toEqual({
      state: 'failed',
      failures: [{ hash, problem: 'not-canonical' }],
    })
  })

  it('fails bytes that are not a statement', async () => {
    const bytes = new TextEncoder().encode(canonicalJson({ audio: true }))
    const hash = await sha256Hex(bytes)

    expect(await verifyRecordingStatements(blob, [{ hash, bytes }])).toEqual({
      state: 'failed',
      failures: [{ hash, problem: 'malformed' }],
    })
  })

  it("can't check a statement that could not be fetched", async () => {
    const claim = await signedClaim()
    const receipt = await receiptFor(claim)
    const hash = await statementAddress(receipt)

    expect(
      await verify(fetched(claim), Promise.resolve({ hash, bytes: null })),
    ).toEqual({ state: 'unavailable', missing: [hash] })
  })

  it('reports a failure over a statement it could not fetch', async () => {
    const other = await signedClaim({ hash: 'cd'.repeat(32), size: 1024 })

    expect(
      await verify(
        fetched(other),
        Promise.resolve({ hash: 'ef'.repeat(32), bytes: null }),
      ),
    ).toMatchObject({ state: 'failed' })
  })

  it('treats a listed address that repeats as one statement', async () => {
    const claim = await signedClaim()

    expect(
      await verify(
        fetched(claim),
        fetched(claim),
        fetched(await receiptFor(claim)),
      ),
    ).toMatchObject({ state: 'verified' })
  })
})
