import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonicalJson'
import { sha256Hex } from './encoding'
import { createDeviceCertificate } from './deviceCertificate'
import { createDeviceRevocation } from './deviceRevocation'
import { createDeviceVouch, createVouchRequest } from './deviceVouch'
import { createHostReceipt } from './hostReceipt'
import { createRecordingClaim, NO_SESSION_ID } from './recordingClaim'
import {
  verifyRecordingStatements,
  type FetchedStatement,
} from './recordingProvenance'
import { createSessionRecord } from './sessionRecord'
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
const personKeys = await generateSigningKeyPair()
const personKey = await exportPublicKey(personKeys.publicKey)

function signedClaim(audio = blob, deviceCert?: string) {
  return createRecordingClaim(
    {
      blob: { ...audio, mimeType: 'audio/mp4' },
      startedAt: '2026-10-05T12:00:00.000Z',
      endedAt: '2026-10-05T12:03:00.000Z',
      sessionId: 'session-1',
      deviceCert,
    },
    deviceKeys,
  )
}

function certificateFor(key = deviceKey) {
  return createDeviceCertificate(
    {
      deviceKey: key,
      deviceLabel: 'Studio phone',
      issuedAt: new Date('2026-10-01T09:00:00.000Z'),
    },
    personKeys,
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

async function sessionFor(claims: Signed<unknown>[], sessionId = 'session-1') {
  return createSessionRecord(
    {
      sessionId,
      openedAt: new Date('2026-10-05T11:55:00.000Z'),
      closedAt: new Date('2026-10-05T12:10:00.000Z'),
      devices: [
        {
          deviceKey,
          label: 'Studio phone',
          spans: [
            {
              joinedAt: '2026-10-05T11:58:00.000Z',
              leftAt: '2026-10-05T12:10:00.000Z',
            },
          ],
        },
      ],
      claims: await Promise.all(claims.map((claim) => statementAddress(claim))),
    },
    hostKeys,
  )
}

async function vouchFor(keys = deviceKeys) {
  const request = await createVouchRequest(
    { personKey, deviceLabel: 'New phone' },
    keys,
  )
  return createDeviceVouch(
    {
      request: request.payload,
      hostLabel: 'Studio Mac',
      personName: 'Sam',
      method: 'pin',
      firstCertificate: await statementAddress(await certificateFor()),
      vouchedAt: new Date('2026-10-05T11:50:00.000Z'),
    },
    hostKeys,
  )
}

async function revocationFor(
  link: Signed<unknown>,
  details: {
    signedBy?: 'person' | 'host'
    reason?: 'lost' | 'retired' | 'wrong-person'
    revokedAt?: string
  } = {},
  keys = personKeys,
) {
  return createDeviceRevocation(
    {
      signedBy: details.signedBy ?? 'person',
      deviceKey,
      deviceLink: await statementAddress(link),
      reason: details.reason ?? 'lost',
      revokedAt: new Date(details.revokedAt ?? '2026-10-20T08:00:00.000Z'),
    },
    keys,
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

  it('shows the session from a record that lists the claim', async () => {
    const claim = await signedClaim()

    expect(
      await verify(
        fetched(claim),
        fetched(await receiptFor(claim)),
        fetched(await sessionFor([claim])),
      ),
    ).toMatchObject({
      state: 'verified',
      sessionId: 'session-1',
      session: {
        openedAt: '2026-10-05T11:55:00.000Z',
        closedAt: '2026-10-05T12:10:00.000Z',
        hostKey: await exportPublicKey(hostKeys.publicKey),
        // The label is the device's own word, so it is not passed on.
        devices: [
          {
            deviceKey,
            spans: [
              {
                joinedAt: '2026-10-05T11:58:00.000Z',
                leftAt: '2026-10-05T12:10:00.000Z',
              },
            ],
          },
        ],
      },
    })
  })

  it('shows the session on a claim signed on device only', async () => {
    const claim = await signedClaim()

    expect(
      await verify(fetched(claim), fetched(await sessionFor([claim]))),
    ).toMatchObject({ state: 'device-only', session: { devices: [{}] } })
  })

  it('has no session without a session record', async () => {
    const claim = await signedClaim()

    expect(
      await verify(fetched(claim), fetched(await receiptFor(claim))),
    ).not.toHaveProperty('session')
  })

  it('fails a session record for another session', async () => {
    const claim = await signedClaim()
    const record = await sessionFor([claim], 'session-2')

    expect(
      await verify(
        fetched(claim),
        fetched(await receiptFor(claim)),
        fetched(record),
      ),
    ).toEqual({
      state: 'failed',
      failures: [
        { hash: await statementAddress(record), problem: 'session-mismatch' },
      ],
    })
  })

  it('fails a session record that does not list the claim', async () => {
    const claim = await signedClaim()
    const other = await signedClaim({ hash: 'cd'.repeat(32), size: 1 })
    const record = await sessionFor([other])

    expect(
      await verify(
        fetched(claim),
        fetched(await receiptFor(claim)),
        fetched(record),
      ),
    ).toEqual({
      state: 'failed',
      failures: [
        {
          hash: await statementAddress(record),
          problem: 'claim-not-in-session',
        },
      ],
    })
  })

  it('fails a session record whose signature does not verify', async () => {
    const claim = await signedClaim()
    const record = await sessionFor([claim])
    const tampered = {
      ...record,
      payload: { ...record.payload, closedAt: '2026-10-05T13:00:00.000Z' },
    }

    expect(await verify(fetched(claim), fetched(tampered))).toMatchObject({
      state: 'failed',
      failures: [{ problem: 'bad-signature' }],
    })
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

  describe('device certificates', () => {
    it('shows the person a passing certificate names', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim(blob, await statementAddress(certificate))

      expect(
        await verify(
          fetched(claim),
          fetched(await receiptFor(claim)),
          fetched(certificate),
        ),
      ).toMatchObject({
        state: 'verified',
        deviceKey,
        person: {
          via: 'certificate',
          personKey,
          deviceLabel: 'Studio phone',
          issuedAt: '2026-10-01T09:00:00.000Z',
        },
      })
    })

    it('is unavailable when the named certificate is not listed', async () => {
      const certificate = await certificateFor()
      const address = await statementAddress(certificate)
      const claim = await signedClaim(blob, address)

      expect(
        await verify(fetched(claim), fetched(await receiptFor(claim))),
      ).toEqual({ state: 'unavailable', missing: [address] })
    })

    it('fails a certificate for another device', async () => {
      const other = await exportPublicKey(
        (await generateSigningKeyPair()).publicKey,
      )
      const certificate = await certificateFor(other)
      const address = await statementAddress(certificate)
      const claim = await signedClaim(blob, address)

      expect(await verify(fetched(claim), fetched(certificate))).toEqual({
        state: 'failed',
        failures: [{ hash: address, problem: 'certificate-device-mismatch' }],
      })
    })

    it('fails a certificate no claim names', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim()

      expect(await verify(fetched(claim), fetched(certificate))).toEqual({
        state: 'failed',
        failures: [
          {
            hash: await statementAddress(certificate),
            problem: 'certificate-not-claimed',
          },
        ],
      })
    })

    it('fails a certificate signed by another key', async () => {
      const certificate = await certificateFor()
      const forged = {
        payload: certificate.payload,
        signature: (
          await signStatement(certificate.payload, deviceKeys.privateKey)
        ).signature,
      }
      const address = await statementAddress(forged)
      const claim = await signedClaim(blob, address)

      expect(await verify(fetched(claim), fetched(forged))).toEqual({
        state: 'failed',
        failures: [{ hash: address, problem: 'bad-signature' }],
      })
    })
  })

  describe('device vouches', () => {
    it('shows the person and host a passing vouch names', async () => {
      const vouch = await vouchFor()
      const claim = await signedClaim(blob, await statementAddress(vouch))

      expect(
        await verify(
          fetched(claim),
          fetched(await receiptFor(claim)),
          fetched(vouch),
        ),
      ).toMatchObject({
        state: 'verified',
        deviceKey,
        person: {
          via: 'vouch',
          personKey,
          personName: 'Sam',
          deviceLabel: 'New phone',
          hostKey: await exportPublicKey(hostKeys.publicKey),
          hostLabel: 'Studio Mac',
          method: 'pin',
          vouchedAt: '2026-10-05T11:50:00.000Z',
        },
      })
    })

    it('fails a vouch for another device', async () => {
      const vouch = await vouchFor(await generateSigningKeyPair())
      const address = await statementAddress(vouch)
      const claim = await signedClaim(blob, address)

      expect(await verify(fetched(claim), fetched(vouch))).toEqual({
        state: 'failed',
        failures: [{ hash: address, problem: 'certificate-device-mismatch' }],
      })
    })

    it('fails a vouch no claim names', async () => {
      const vouch = await vouchFor()
      const claim = await signedClaim()

      expect(await verify(fetched(claim), fetched(vouch))).toEqual({
        state: 'failed',
        failures: [
          {
            hash: await statementAddress(vouch),
            problem: 'certificate-not-claimed',
          },
        ],
      })
    })

    it('fails a vouch with a changed person name', async () => {
      const vouch = await vouchFor()
      const changed = {
        ...vouch,
        payload: { ...vouch.payload, personName: 'Alex' },
      }
      const address = await statementAddress(changed)
      const claim = await signedClaim(blob, address)

      expect(await verify(fetched(claim), fetched(changed))).toEqual({
        state: 'failed',
        failures: [{ hash: address, problem: 'bad-signature' }],
      })
    })
  })

  describe('device revocations', () => {
    it('keeps a recording the host had before trust ended', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim(blob, await statementAddress(certificate))

      expect(
        await verify(
          fetched(claim),
          fetched(await receiptFor(claim)),
          fetched(certificate),
          fetched(await revocationFor(certificate)),
        ),
      ).toMatchObject({
        state: 'verified',
        person: { via: 'certificate', personKey },
        revocation: {
          signedBy: 'person',
          signerKey: personKey,
          reason: 'lost',
          revokedAt: '2026-10-20T08:00:00.000Z',
          receivedBeforeRevocation: true,
        },
      })
    })

    it('doubts a recording the host got after trust ended', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim(blob, await statementAddress(certificate))

      expect(
        await verify(
          fetched(claim),
          fetched(await receiptFor(claim, '2026-10-25T10:00:00.000Z')),
          fetched(certificate),
          fetched(await revocationFor(certificate)),
        ),
      ).toMatchObject({
        state: 'verified',
        revocation: { receivedBeforeRevocation: false },
      })
    })

    it('doubts a recording no host ever received', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim(blob, await statementAddress(certificate))

      expect(
        await verify(
          fetched(claim),
          fetched(certificate),
          fetched(await revocationFor(certificate)),
        ),
      ).toMatchObject({
        state: 'device-only',
        revocation: { receivedBeforeRevocation: false },
      })
    })

    it('treats a revoked vouch the same as a revoked certificate', async () => {
      const vouch = await vouchFor()
      const claim = await signedClaim(blob, await statementAddress(vouch))

      expect(
        await verify(
          fetched(claim),
          fetched(await receiptFor(claim)),
          fetched(vouch),
          fetched(
            await revocationFor(
              vouch,
              { signedBy: 'host', reason: 'wrong-person' },
              hostKeys,
            ),
          ),
        ),
      ).toMatchObject({
        state: 'verified',
        person: { via: 'vouch' },
        revocation: {
          signedBy: 'host',
          reason: 'wrong-person',
          receivedBeforeRevocation: true,
        },
      })
    })

    it('shows the first of several revocations', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim(blob, await statementAddress(certificate))

      expect(
        await verify(
          fetched(claim),
          fetched(certificate),
          fetched(
            await revocationFor(certificate, {
              reason: 'retired',
              revokedAt: '2026-10-22T08:00:00.000Z',
            }),
          ),
          fetched(await revocationFor(certificate)),
        ),
      ).toMatchObject({
        revocation: { reason: 'lost', revokedAt: '2026-10-20T08:00:00.000Z' },
      })
    })

    it('fails a revocation signed by a key the statement does not name', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim(blob, await statementAddress(certificate))
      const forged = await revocationFor(
        certificate,
        {},
        await generateSigningKeyPair(),
      )

      expect(
        await verify(fetched(claim), fetched(certificate), fetched(forged)),
      ).toEqual({
        state: 'failed',
        failures: [
          {
            hash: await statementAddress(forged),
            problem: 'revocation-not-permitted',
          },
        ],
      })
    })

    it('fails a host revoking a certificate the person key signed', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim(blob, await statementAddress(certificate))
      const overreach = await revocationFor(
        certificate,
        { signedBy: 'host' },
        hostKeys,
      )

      expect(
        await verify(fetched(claim), fetched(certificate), fetched(overreach)),
      ).toEqual({
        state: 'failed',
        failures: [
          {
            hash: await statementAddress(overreach),
            problem: 'revocation-not-permitted',
          },
        ],
      })
    })

    it('fails a revocation of a statement no claim names', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim()
      const revocation = await revocationFor(certificate)

      expect(await verify(fetched(claim), fetched(revocation))).toEqual({
        state: 'failed',
        failures: [
          {
            hash: await statementAddress(revocation),
            problem: 'revocation-not-claimed',
          },
        ],
      })
    })

    it('fails a revocation whose signature does not verify', async () => {
      const certificate = await certificateFor()
      const claim = await signedClaim(blob, await statementAddress(certificate))
      const revocation = await revocationFor(certificate)
      const changed = {
        ...revocation,
        payload: { ...revocation.payload, reason: 'retired' as const },
      }

      expect(
        await verify(fetched(claim), fetched(certificate), fetched(changed)),
      ).toEqual({
        state: 'failed',
        failures: [
          {
            hash: await statementAddress(changed),
            problem: 'bad-signature',
          },
        ],
      })
    })
  })
})
