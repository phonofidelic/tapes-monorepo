import { afterEach, describe, expect, it, vi } from 'vitest'
import { personKeyServiceToken } from '@tapes-monorepo/provenance'
import { callWorker } from '@/workerClient'
import { fetchPasskeyRecord, storePasskeyRecord } from './passkeyRecordClient'

vi.mock('@/workerClient', () => ({ callWorker: vi.fn() }))

const worker = {} as Worker
const ENDPOINT = { baseUrl: 'https://192.168.1.20:433', token: 'pair-token' }

const PASSKEY = {
  ok: true as const,
  credentialId: 'credential-id',
  rpId: 'tapes.network',
  prf: new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>,
}

const WRITTEN = {
  write: 'encoded-write',
  record: '{"format":"tapes-person-key-backup"}',
  token: 'service-token',
}

afterEach(() => {
  vi.clearAllMocks()
})

function workerAnswers() {
  vi.mocked(callWorker).mockImplementation((_worker, type) =>
    Promise.resolve(
      type === 'person:passkey-record'
        ? WRITTEN
        : { passkeyRecordedAt: '2026-10-29T09:00:00.000Z' },
    ),
  )
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe('storePasskeyRecord', () => {
  it('signs over a fresh challenge and posts the record', async () => {
    workerAnswers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ challenge: 'c1' }))
      .mockResolvedValueOnce(json({ ok: true }))

    const result = await storePasskeyRecord(
      worker,
      ENDPOINT,
      PASSKEY,
      fetchImpl,
    )

    expect(result).toEqual({
      ok: true,
      passkeyRecordedAt: '2026-10-29T09:00:00.000Z',
    })
    expect(callWorker).toHaveBeenCalledWith(worker, 'person:passkey-record', {
      prf: PASSKEY.prf,
      rpId: 'tapes.network',
      credentialId: 'credential-id',
      challenge: 'c1',
    })

    const [url, init] = fetchImpl.mock.calls[1]
    expect(url).toBe('https://192.168.1.20:433/person-key-records')
    expect(JSON.parse(String(init?.body))).toEqual(WRITTEN)
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer pair-token',
    )
  })

  it('reports why the host would not keep it', async () => {
    workerAnswers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ challenge: 'c1' }))
      .mockResolvedValueOnce(json({ ok: false, error: 'unknown-person' }, 404))

    expect(
      await storePasskeyRecord(worker, ENDPOINT, PASSKEY, fetchImpl),
    ).toEqual({ ok: false, problem: 'refused', detail: 'unknown-person' })
    // Nothing is noted on this device when the host did not take it.
    expect(callWorker).not.toHaveBeenCalledWith(
      worker,
      'person:mark-record',
      undefined,
    )
  })

  it('reports a host that cannot be reached', async () => {
    workerAnswers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('offline'))

    expect(
      await storePasskeyRecord(worker, ENDPOINT, PASSKEY, fetchImpl),
    ).toEqual({ ok: false, problem: 'unreachable' })
    expect(callWorker).not.toHaveBeenCalled()
  })
})

describe('fetchPasskeyRecord', () => {
  it('asks with the token the passkey derives', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ ok: true, record: 'the-record' }))

    expect(await fetchPasskeyRecord(ENDPOINT, PASSKEY, fetchImpl)).toEqual({
      ok: true,
      record: 'the-record',
    })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://192.168.1.20:433/person-key-records/fetch')
    expect(JSON.parse(String(init?.body))).toEqual({
      credentialId: 'credential-id',
      token: await personKeyServiceToken(PASSKEY.prf),
    })
  })

  it('keeps the token out of the url', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ ok: true, record: 'the-record' }))

    await fetchPasskeyRecord(ENDPOINT, PASSKEY, fetchImpl)

    const token = await personKeyServiceToken(PASSKEY.prf)
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain(token)
  })

  it('reports no record for a 404', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ ok: false, error: 'no-record' }, 404))

    expect(await fetchPasskeyRecord(ENDPOINT, PASSKEY, fetchImpl)).toEqual({
      ok: false,
      problem: 'no-record',
    })
  })

  it('tells a host that is down apart from one with no record', async () => {
    const down = vi.fn<typeof fetch>().mockResolvedValue(json({}, 503))
    expect(await fetchPasskeyRecord(ENDPOINT, PASSKEY, down)).toEqual({
      ok: false,
      problem: 'unreachable',
    })

    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('offline'))
    expect(await fetchPasskeyRecord(ENDPOINT, PASSKEY, offline)).toEqual({
      ok: false,
      problem: 'unreachable',
    })
  })
})
