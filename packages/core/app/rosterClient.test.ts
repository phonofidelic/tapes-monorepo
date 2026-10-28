import { afterEach, describe, expect, it, vi } from 'vitest'
import { callWorker } from '@/workerClient'
import { joinHostRoster } from './rosterClient'

vi.mock('@/workerClient', () => ({ callWorker: vi.fn() }))

const worker = {} as Worker
const ENDPOINT = { baseUrl: 'https://192.168.1.20:433', token: 'pair-token' }

afterEach(() => {
  vi.clearAllMocks()
})

function workerAnswers() {
  vi.mocked(callWorker).mockImplementation((_worker, type) =>
    Promise.resolve(
      type === 'person:sign-join'
        ? { join: 'encoded-join', certificate: 'encoded-certificate' }
        : { joinedAt: '2026-10-22T09:00:00.000Z' },
    ),
  )
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe('joinHostRoster', () => {
  it('signs over a fresh challenge and posts the join with the PIN', async () => {
    workerAnswers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ challenge: 'c1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const result = await joinHostRoster(
      worker,
      ENDPOINT,
      { personName: 'Sam', pin: '4821' },
      fetchImpl,
    )

    expect(result).toEqual({ ok: true, joinedAt: '2026-10-22T09:00:00.000Z' })
    expect(callWorker).toHaveBeenCalledWith(worker, 'person:sign-join', {
      challenge: 'c1',
      personName: 'Sam',
    })
    const [url, init] = fetchImpl.mock.calls[1]
    expect(url).toBe('https://192.168.1.20:433/people')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer pair-token',
    )
    expect(JSON.parse(init?.body as string)).toEqual({
      join: 'encoded-join',
      certificate: 'encoded-certificate',
      pin: '4821',
    })
  })

  it('marks nothing joined when the host refuses', async () => {
    workerAnswers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ challenge: 'c1' }))
      .mockResolvedValueOnce(json({ error: 'bad-pin' }, 400))

    expect(
      await joinHostRoster(worker, ENDPOINT, { personName: 'Sam' }, fetchImpl),
    ).toEqual({ ok: false, problem: 'refused', detail: 'bad-pin' })
    expect(callWorker).not.toHaveBeenCalledWith(worker, 'person:mark-joined')
  })

  it('reports a host that cannot be reached', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError())

    expect(
      await joinHostRoster(worker, ENDPOINT, { personName: 'Sam' }, fetchImpl),
    ).toEqual({ ok: false, problem: 'unreachable' })
    expect(callWorker).not.toHaveBeenCalled()
  })
})
