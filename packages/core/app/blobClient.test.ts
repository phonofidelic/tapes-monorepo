import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BlobFetchError,
  BlobRequestError,
  classifyBlobFailure,
  deleteBlob,
  fetchBlob,
  headBlob,
  deleteBlobEverywhere,
  fetchBlobFromAny,
  replicateBlob,
  resolveBlobEndpoints,
  uploadBlob,
} from './blobClient'

const ENDPOINT = { baseUrl: 'http://127.0.0.1:9001', token: 'pair-token' }
const DOC = 'automerge:doc-a'
const HASH = 'a'.repeat(64)

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveBlobEndpoints', () => {
  it('puts the embedded host advertised over IPC first, marked local', () => {
    expect(
      resolveBlobEndpoints({
        syncServerInfo: {
          blobBaseUrl: 'http://127.0.0.1:9001/',
          pairingToken: 'host-token',
        },
        origin: 'http://localhost:3000',
        isDev: true,
      })[0],
    ).toEqual({
      baseUrl: 'http://127.0.0.1:9001',
      token: 'host-token',
      local: true,
    })
  })

  it('uses the page origin when the host serves this bundle', () => {
    expect(
      resolveBlobEndpoints({
        origin: 'https://192.168.1.20:9001',
        servedByHost: true,
        token: 'pair-token',
      }),
    ).toEqual([{ baseUrl: 'https://192.168.1.20:9001', token: 'pair-token' }])
  })

  it('derives an http origin from a remote sync url', () => {
    expect(
      resolveBlobEndpoints({
        remoteSyncServerUrl: 'wss://sync.example.com/sync',
        token: 'pair-token',
      }),
    ).toEqual([{ baseUrl: 'https://sync.example.com', token: 'pair-token' }])
  })

  // The case this exists for: an electron client in `syncServerMode: 'remote'`
  // syncs docs whose bytes only the remote host has, and used to 404 against
  // its own store with nowhere else to ask.
  it('keeps the embedded host and a remote one, in that order', () => {
    expect(
      resolveBlobEndpoints({
        syncServerInfo: {
          blobBaseUrl: 'http://127.0.0.1:9001',
          pairingToken: 'host-token',
        },
        remoteSyncServerUrl: 'wss://sync.example.com/sync?t=pair-token',
        token: 'pair-token',
      }),
    ).toEqual([
      { baseUrl: 'http://127.0.0.1:9001', token: 'host-token', local: true },
      { baseUrl: 'https://sync.example.com', token: 'pair-token' },
    ])
  })

  it('lists a host reachable two ways only once', () => {
    expect(
      resolveBlobEndpoints({
        origin: 'https://192.168.1.20:9001',
        servedByHost: true,
        remoteSyncServerUrl: 'wss://192.168.1.20:9001/sync',
        token: 'pair-token',
      }),
    ).toEqual([{ baseUrl: 'https://192.168.1.20:9001', token: 'pair-token' }])
  })

  it('will not use a remote sync url without a pairing token', () => {
    // Every request would 401, so there is nothing to be gained by trying.
    expect(
      resolveBlobEndpoints({
        remoteSyncServerUrl: 'wss://sync.example.com/sync',
      }),
    ).toEqual([])
  })

  // A standalone web-client with no host is a supported configuration, not a
  // failure: its bytes simply stay in OPFS.
  it('resolves nothing for a local-only client', () => {
    expect(
      resolveBlobEndpoints({ origin: 'https://tapes.example.com' }),
    ).toEqual([])
  })
})

describe('uploadBlob', () => {
  it('posts the bytes and returns the descriptor', async () => {
    const fetchMock = stubFetch(
      jsonResponse(201, {
        hash: HASH,
        size: 12,
        mimeType: 'audio/wav',
        ext: '.wav',
        deduped: false,
      }),
    )
    const body = new Blob(['recorded'], { type: 'audio/wav' })

    const descriptor = await uploadBlob(ENDPOINT, body, {
      mimeType: 'audio/wav',
      docUrl: DOC,
    })

    expect(descriptor).toEqual({
      hash: HASH,
      size: 12,
      mimeType: 'audio/wav',
      ext: '.wav',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `http://127.0.0.1:9001/blobs?doc=${encodeURIComponent(DOC)}`,
    )
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer pair-token',
      'Content-Type': 'audio/wav',
      'X-Tapes-Recording-Url': DOC,
    })
    // The File/Blob is handed to fetch as-is so it streams off disk rather
    // than being read into memory.
    expect(init.body).toBe(body)
  })

  it('throws a typed error carrying the status', async () => {
    stubFetch(jsonResponse(413, { error: 'Blob exceeds the limit' }))

    const failure = uploadBlob(ENDPOINT, new Blob(['x']), {
      mimeType: 'audio/wav',
      docUrl: DOC,
    })

    await expect(failure).rejects.toBeInstanceOf(BlobRequestError)
    await expect(failure).rejects.toThrow('Blob exceeds the limit')
  })
})

describe('fetchBlob', () => {
  it('sends the bearer token and returns the bytes', async () => {
    const fetchMock = stubFetch(
      new Response('audio bytes', {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      }),
    )

    const blob = await fetchBlob(ENDPOINT, HASH)

    // jsdom's Blob has no `text()`, unlike a real browser's, so assert on the
    // properties it does expose.
    expect(blob.size).toBe('audio bytes'.length)
    expect(blob.type).toBe('audio/wav')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`http://127.0.0.1:9001/blobs/${HASH}`)
    expect(init.headers).toEqual({ Authorization: 'Bearer pair-token' })
  })

  it('rejects with the status when the host does not have it', async () => {
    stubFetch(jsonResponse(404, { error: 'Unknown blob' }))

    await expect(fetchBlob(ENDPOINT, HASH)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('aborts an in-flight request when the caller withdraws', async () => {
    // The signal reaching `fetch` is no longer the caller's own object: it is
    // linked to one that also carries the response deadline. What has to hold
    // is that the caller's abort still reaches the request, and that it stays
    // an abort rather than being reported as this host timing out.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )
    const controller = new AbortController()

    const pending = fetchBlob(ENDPOINT, HASH, { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('gives up on a host that accepts the connection and says nothing', async () => {
    // Previously this hung forever: no timeout was ever wired in, so a silent
    // host left playback stuck on "Downloading…" rather than failing over.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )

    await expect(
      fetchBlob(ENDPOINT, HASH, { timeoutMs: 5 }),
    ).rejects.toMatchObject({ status: 408 })
  })
})

describe('classifyBlobFailure', () => {
  it('lets an unauthorized host outrank one that simply lacks the blob', () => {
    // The 401 is the actionable one: re-pair. A 404 from another host says
    // nothing about it, and must not be what the user is told.
    expect(
      classifyBlobFailure([
        { kind: 'status', status: 404 },
        { kind: 'status', status: 401 },
      ]),
    ).toBe('unauthorized')
  })

  it('prefers an unreachable host to a definitive miss', () => {
    expect(
      classifyBlobFailure([
        { kind: 'status', status: 404 },
        { kind: 'network' },
      ]),
    ).toBe('unreachable')
  })

  it('reports a miss only when every host that answered said no', () => {
    expect(classifyBlobFailure([{ kind: 'status', status: 404 }])).toBe(
      'missing',
    )
  })

  it('treats a broken host as an absent one', () => {
    expect(classifyBlobFailure([{ kind: 'status', status: 503 }])).toBe(
      'unreachable',
    )
  })
})

describe('headBlob', () => {
  it('reports size and type without a body', async () => {
    stubFetch(
      new Response(null, {
        status: 200,
        headers: { 'Content-Length': '2048', 'Content-Type': 'audio/mp4' },
      }),
    )

    await expect(headBlob(ENDPOINT, HASH)).resolves.toEqual({
      size: 2048,
      mimeType: 'audio/mp4',
    })
  })

  it('returns null for an unknown hash', async () => {
    stubFetch(new Response(null, { status: 404 }))

    await expect(headBlob(ENDPOINT, HASH)).resolves.toBeNull()
  })
})

describe('deleteBlob', () => {
  it('releases this document’s claim on the bytes', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }))

    await deleteBlob(ENDPOINT, HASH, DOC)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `http://127.0.0.1:9001/blobs/${HASH}?doc=${encodeURIComponent(DOC)}`,
    )
    expect(init.method).toBe('DELETE')
  })

  it('treats an already-deleted blob as success', async () => {
    stubFetch(jsonResponse(404, { error: 'Unknown blob' }))

    await expect(deleteBlob(ENDPOINT, HASH, DOC)).resolves.toBeUndefined()
  })
})

const LOCAL = { baseUrl: 'http://127.0.0.1:9001', token: 'host', local: true }
const REMOTE = { baseUrl: 'https://sync.example.com', token: 'pair-token' }

/** Answers each request from `byBaseUrl`, keyed by the origin it was sent to. */
function stubHosts(byBaseUrl: Record<string, () => Response>) {
  const fetchMock = vi.fn((url: string) => {
    const host = Object.keys(byBaseUrl).find((base) => url.startsWith(base))
    return Promise.resolve(
      host ? byBaseUrl[host]() : new Response(null, { status: 502 }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchBlobFromAny', () => {
  it('falls back to the next host when the first has never seen the blob', async () => {
    const fetchMock = stubHosts({
      [LOCAL.baseUrl]: () => jsonResponse(404, { error: 'Unknown blob' }),
      [REMOTE.baseUrl]: () => new Response('audio bytes', { status: 200 }),
    })

    const result = await fetchBlobFromAny([LOCAL, REMOTE], HASH)

    expect(result.blob.size).toBe('audio bytes'.length)
    expect(result.from).toBe(REMOTE)
    expect(result.missingFrom).toEqual([LOCAL])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops at the first host that has it', async () => {
    const fetchMock = stubHosts({
      [LOCAL.baseUrl]: () => new Response('audio bytes', { status: 200 }),
      [REMOTE.baseUrl]: () => new Response('audio bytes', { status: 200 }),
    })

    const result = await fetchBlobFromAny([LOCAL, REMOTE], HASH)

    expect(result.from).toBe(LOCAL)
    expect(result.missingFrom).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports why across every host, not just the last one asked', async () => {
    // Asking in this order used to report the 401 only because it happened to
    // come last. Reverse them and the same run reported "not found", which is
    // the one thing the user could do nothing about.
    stubHosts({
      [LOCAL.baseUrl]: () => jsonResponse(401, { error: 'Unauthorized' }),
      [REMOTE.baseUrl]: () => jsonResponse(404, { error: 'Unknown blob' }),
    })

    await expect(fetchBlobFromAny([LOCAL, REMOTE], HASH)).rejects.toMatchObject(
      { reason: 'unauthorized' },
    )
  })

  it('keeps the underlying error as the cause', async () => {
    stubHosts({
      [LOCAL.baseUrl]: () => jsonResponse(404, { error: 'Unknown blob' }),
    })

    const error = await fetchBlobFromAny([LOCAL], HASH).catch((e) => e)
    expect(error).toBeInstanceOf(BlobFetchError)
    expect(error.cause).toBeInstanceOf(BlobRequestError)
  })

  it('says this device is paired with nothing when it has no endpoints', async () => {
    await expect(fetchBlobFromAny([], HASH)).rejects.toMatchObject({
      reason: 'unpaired',
    })
  })
})

describe('replicateBlob', () => {
  it('uploads to every host that was missing the blob', async () => {
    const fetchMock = stubHosts({
      [REMOTE.baseUrl]: () =>
        jsonResponse(201, {
          hash: HASH,
          size: 11,
          mimeType: 'audio/wav',
          ext: '.wav',
        }),
    })

    await replicateBlob([REMOTE], new Blob(['audio bytes']), {
      mimeType: 'audio/wav',
      docUrl: DOC,
      expectedHash: HASH,
    })

    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://sync.example.com/blobs?doc=${encodeURIComponent(DOC)}`,
    )
  })

  it('swallows a failed copy: playback already succeeded', async () => {
    stubHosts({
      [REMOTE.baseUrl]: () => jsonResponse(507, { error: 'Store is full' }),
    })

    await expect(
      replicateBlob([REMOTE], new Blob(['audio bytes']), {
        mimeType: 'audio/wav',
        docUrl: DOC,
        expectedHash: HASH,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('deleteBlobEverywhere', () => {
  it('releases the claim on each host and ignores the ones that fail', async () => {
    const fetchMock = stubHosts({
      [LOCAL.baseUrl]: () => new Response(null, { status: 204 }),
      [REMOTE.baseUrl]: () => jsonResponse(500, { error: 'Nope' }),
    })

    await expect(
      deleteBlobEverywhere([LOCAL, REMOTE], HASH, DOC),
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
