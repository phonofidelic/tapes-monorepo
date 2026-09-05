import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AggregatesRequestError,
  fetchAggregates,
  type RecordingAggregate,
} from './aggregatesClient'
import type { IpcService } from './IpcService'
import type { EventHost } from './eventTarget'

const HTTP: EventHost = {
  kind: 'http',
  baseUrl: 'http://127.0.0.1:9001',
  token: 'pair-token',
}
const RECORDING = 'automerge:2j9knpCseyhnK8izDmiqpZM7bJq'

function row(overrides: Partial<RecordingAggregate> = {}): RecordingAggregate {
  return {
    recordingUrl: RECORDING,
    plays: 3,
    averageCompletion: 0.5,
    ...overrides,
  }
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

/** Just enough of `IpcService` to answer one channel. */
function stubIpc(response: unknown): IpcService {
  return { send: vi.fn().mockResolvedValue(response) } as unknown as IpcService
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchAggregates over http', () => {
  it('sends the pairing token and returns the host snapshot', async () => {
    const fetchMock = stubFetch(
      jsonResponse(
        200,
        { aggregates: [row()], generatedAt: '2026-09-05T10:00:00.000Z' },
        { ETag: '"abc"' },
      ),
    )

    const result = await fetchAggregates(HTTP)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9001/events/aggregates',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer pair-token',
        }),
      }),
    )
    expect(result).toEqual({
      status: 'fresh',
      snapshot: {
        aggregates: [row()],
        generatedAt: '2026-09-05T10:00:00.000Z',
        etag: '"abc"',
      },
    })
  })

  // The point of revalidating: a reconnect after a day away costs a header,
  // not the whole library.
  it('revalidates with the held tag and reports an unchanged library', async () => {
    const fetchMock = stubFetch(jsonResponse(304, null))

    const result = await fetchAggregates(HTTP, { etag: '"abc"' })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'If-None-Match': '"abc"' }),
      }),
    )
    expect(result).toEqual({ status: 'unchanged' })
  })

  it('raises the host error for a rejected read', async () => {
    stubFetch(jsonResponse(401, { error: 'Unauthorized' }))

    await expect(fetchAggregates(HTTP)).rejects.toThrow(AggregatesRequestError)
  })

  // One malformed row from a host of another version must not cost the library
  // its numbers: these are decorations on a list that renders without them.
  it('keeps the rows it understands and drops the rest', async () => {
    stubFetch(
      jsonResponse(200, {
        aggregates: [
          row(),
          null,
          { recordingUrl: 'automerge:b' },
          { recordingUrl: 'automerge:c', plays: 'many', averageCompletion: 1 },
          { recordingUrl: '', plays: 1, averageCompletion: 1 },
        ],
        generatedAt: '2026-09-05T10:00:00.000Z',
      }),
    )

    const result = await fetchAggregates(HTTP)

    expect(result).toEqual({
      status: 'fresh',
      snapshot: expect.objectContaining({ aggregates: [row()] }),
    })
  })

  // A host reporting 1.02 is a rounding artefact of a play that finished, not
  // a reason to render 102%.
  it('clamps a completion the host reports out of range', async () => {
    stubFetch(
      jsonResponse(200, {
        aggregates: [row({ averageCompletion: 1.02 })],
        generatedAt: '2026-09-05T10:00:00.000Z',
      }),
    )

    const result = await fetchAggregates(HTTP)

    expect(
      result.status === 'fresh' && result.snapshot.aggregates[0],
    ).toMatchObject({ averageCompletion: 1 })
  })

  it('gives up on a host that does not answer in time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            )
          }),
      ),
    )

    await expect(fetchAggregates(HTTP, { timeoutMs: 1 })).rejects.toThrow(
      'The host did not answer in time',
    )
  })
})

describe('fetchAggregates over ipc', () => {
  it('reads the embedded host without touching the network', async () => {
    const fetchMock = stubFetch(jsonResponse(200, {}))
    const ipc = stubIpc({
      success: true,
      data: {
        aggregates: [row()],
        generatedAt: '2026-09-05T10:00:00.000Z',
      },
    })

    const result = await fetchAggregates({ kind: 'ipc' }, { ipc })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'fresh',
      snapshot: {
        aggregates: [row()],
        generatedAt: '2026-09-05T10:00:00.000Z',
      },
    })
  })

  // "No aggregate store" is not "nothing has been played": conflating them
  // would render a confident zero on every row.
  it('raises rather than reporting an empty library when the store is absent', async () => {
    const ipc = stubIpc({
      success: false,
      error: { message: 'Playback aggregates are not available' },
    })

    await expect(fetchAggregates({ kind: 'ipc' }, { ipc })).rejects.toThrow(
      'Playback aggregates are not available',
    )
  })
})
