import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BlobRequestError,
  deleteBlob,
  fetchBlob,
  headBlob,
  resolveBlobEndpoint,
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

describe('resolveBlobEndpoint', () => {
  it('prefers the embedded host advertised over IPC', () => {
    expect(
      resolveBlobEndpoint({
        syncServerInfo: {
          blobBaseUrl: 'http://127.0.0.1:9001/',
          pairingToken: 'host-token',
        },
        origin: 'http://localhost:3000',
        isDev: true,
      }),
    ).toEqual({ baseUrl: 'http://127.0.0.1:9001', token: 'host-token' })
  })

  it('uses the page origin when the host serves this bundle', () => {
    expect(
      resolveBlobEndpoint({
        origin: 'https://192.168.1.20:9001',
        servedByHost: true,
        token: 'pair-token',
      }),
    ).toEqual({ baseUrl: 'https://192.168.1.20:9001', token: 'pair-token' })
  })

  it('derives an http origin from a remote sync url', () => {
    expect(
      resolveBlobEndpoint({
        remoteSyncServerUrl: 'wss://sync.example.com/sync',
        token: 'pair-token',
      }),
    ).toEqual({ baseUrl: 'https://sync.example.com', token: 'pair-token' })
  })

  it('will not use a remote sync url without a pairing token', () => {
    // Every request would 401, so there is nothing to be gained by trying.
    expect(
      resolveBlobEndpoint({
        remoteSyncServerUrl: 'wss://sync.example.com/sync',
      }),
    ).toBeUndefined()
  })

  // A standalone web-client with no host is a supported configuration, not a
  // failure: its bytes simply stay in OPFS.
  it('returns undefined for a local-only client', () => {
    expect(
      resolveBlobEndpoint({ origin: 'https://tapes.example.com' }),
    ).toBeUndefined()
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

  it('passes the abort signal through', async () => {
    const fetchMock = stubFetch(new Response('x'))
    const controller = new AbortController()

    await fetchBlob(ENDPOINT, HASH, { signal: controller.signal })

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
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
