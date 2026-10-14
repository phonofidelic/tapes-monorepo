import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHostReceipt,
  createRecordingClaim,
  generateSigningKeyPair,
  statementAddress,
  statementBytes,
  type Signed,
} from '@tapes-monorepo/provenance'
import {
  checkRecordingProvenance,
  clearStatementCache,
} from './recordingProvenance'

const LOCAL = { baseUrl: 'http://127.0.0.1:9001', token: 'host', local: true }
const REMOTE = { baseUrl: 'https://sync.example.com', token: 'pair-token' }

const blob = { hash: 'ab'.repeat(32), size: 1024 }

const claim = await createRecordingClaim(
  {
    blob: { ...blob, mimeType: 'audio/mp4' },
    startedAt: '2026-10-05T12:00:00.000Z',
    endedAt: '2026-10-05T12:03:00.000Z',
  },
  await generateSigningKeyPair(),
)
const receipt = await createHostReceipt(
  claim,
  await generateSigningKeyPair(),
  new Date('2026-10-05T12:03:02.000Z'),
)
const claimHash = await statementAddress(claim)
const receiptHash = await statementAddress(receipt)
const statements = [claimHash, receiptHash]

type Answer = Signed<unknown> | number | 'offline' | string

/**
 * Answers each request by host and hash. A signed statement is served as its
 * stored bytes. A number is a status. A string is served as raw bytes.
 */
function stubHosts(answers: Record<string, Record<string, Answer>>) {
  const fetchMock = vi.fn((url: string) => {
    const host = Object.keys(answers).find((base) => url.startsWith(base))
    const answer = host && answers[host][url.split('/blobs/')[1]]
    if (answer === 'offline') {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    if (answer === undefined || answer === '' || typeof answer === 'number') {
      return Promise.resolve(
        new Response(null, { status: (answer as number) || 404 }),
      )
    }
    const body =
      typeof answer === 'string' ? answer : statementBytes(answer).slice()
    return Promise.resolve(new Response(body, { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => clearStatementCache())

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('checkRecordingProvenance', () => {
  it('verifies the statements a host serves', async () => {
    stubHosts({
      [LOCAL.baseUrl]: { [claimHash]: claim, [receiptHash]: receipt },
    })

    expect(
      await checkRecordingProvenance([LOCAL], { blob, statements }),
    ).toMatchObject({
      state: 'verified',
      receivedAt: '2026-10-05T12:03:02.000Z',
    })
  })

  it('asks the next host when the first does not hold a statement', async () => {
    stubHosts({
      [LOCAL.baseUrl]: { [claimHash]: claim },
      [REMOTE.baseUrl]: { [receiptHash]: receipt },
    })

    expect(
      await checkRecordingProvenance([LOCAL, REMOTE], { blob, statements }),
    ).toMatchObject({ state: 'verified' })
  })

  it('is unverified when the recording lists no statements', async () => {
    const fetchMock = stubHosts({})

    expect(await checkRecordingProvenance([LOCAL], { blob })).toEqual({
      state: 'unverified',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is unverified when there is no audio to bind a claim to', async () => {
    expect(await checkRecordingProvenance([LOCAL], { statements })).toEqual({
      state: 'unverified',
    })
  })

  it('fails bytes that do not hash to the listed address', async () => {
    stubHosts({
      [LOCAL.baseUrl]: { [claimHash]: receipt, [receiptHash]: receipt },
    })

    // The receipt fails too, since the claim it names did not pass.
    expect(
      await checkRecordingProvenance([LOCAL], { blob, statements }),
    ).toEqual({
      state: 'failed',
      failures: expect.arrayContaining([
        { hash: claimHash, problem: 'address-mismatch' },
      ]),
    })
  })

  it.each([
    ['a 404 from every host', { [LOCAL.baseUrl]: {}, [REMOTE.baseUrl]: {} }],
    ['an unreachable host', { [LOCAL.baseUrl]: { [receiptHash]: 'offline' } }],
    ['a rejected pairing', { [LOCAL.baseUrl]: { [receiptHash]: 401 } }],
    ['a host error', { [LOCAL.baseUrl]: { [receiptHash]: 503 } }],
  ] as const)(
    "can't check a statement after %s",
    async (_, answers: Record<string, Record<string, Answer>>) => {
      stubHosts({
        ...answers,
        [LOCAL.baseUrl]: { [claimHash]: claim, ...answers[LOCAL.baseUrl] },
      })

      expect(
        await checkRecordingProvenance([LOCAL, REMOTE], { blob, statements }),
      ).toEqual({ state: 'unavailable', missing: [receiptHash] })
    },
  )

  it("can't check anything when this device is paired with no host", async () => {
    expect(await checkRecordingProvenance([], { blob, statements })).toEqual({
      state: 'unavailable',
      missing: statements,
    })
  })

  it('reports a failure over a statement it could not fetch', async () => {
    stubHosts({ [LOCAL.baseUrl]: { [claimHash]: 'not a statement' } })

    expect(
      await checkRecordingProvenance([LOCAL], { blob, statements }),
    ).toMatchObject({
      state: 'failed',
      failures: [{ hash: claimHash, problem: 'address-mismatch' }],
    })
  })

  it('fetches a verified statement only once', async () => {
    const fetchMock = stubHosts({
      [LOCAL.baseUrl]: { [claimHash]: claim, [receiptHash]: receipt },
    })

    await checkRecordingProvenance([LOCAL], { blob, statements })
    const second = await checkRecordingProvenance([LOCAL], {
      blob,
      statements,
    })

    expect(second).toMatchObject({ state: 'verified' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fetches bytes that failed their hash again', async () => {
    const fetchMock = stubHosts({
      [LOCAL.baseUrl]: { [claimHash]: receipt, [receiptHash]: receipt },
    })

    await checkRecordingProvenance([LOCAL], { blob, statements })
    await checkRecordingProvenance([LOCAL], { blob, statements })

    // The receipt was cached. The bad claim bytes were asked for twice.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects when the caller aborts', async () => {
    stubHosts({ [LOCAL.baseUrl]: { [claimHash]: claim } })
    const controller = new AbortController()
    controller.abort()

    await expect(
      checkRecordingProvenance(
        [LOCAL],
        { blob, statements },
        { signal: controller.signal },
      ),
    ).rejects.toThrow()
  })
})
