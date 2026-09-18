import { describe, it, expect } from 'vitest'
import { authorizeBlobRequest, isBlobRequest } from './blobAuth'

const HOST = 'https://lan-host:3000'

describe('isBlobRequest', () => {
  it('matches a blob fetch from the worker’s own origin', () => {
    expect(isBlobRequest(new Request(`${HOST}/blobs/abc123`), HOST)).toBe(true)
  })

  it('leaves other paths on the same origin alone', () => {
    for (const path of ['/', '/index.html', '/events', '/blobsomething']) {
      expect(isBlobRequest(new Request(`${HOST}${path}`), HOST)).toBe(false)
    }
  })

  it('leaves another host’s blobs alone', () => {
    expect(
      isBlobRequest(new Request('https://elsewhere:3000/blobs/abc123'), HOST),
    ).toBe(false)
  })

  it('leaves uploads alone', () => {
    const upload = new Request(`${HOST}/blobs`, {
      method: 'POST',
      body: 'bytes',
    })
    expect(isBlobRequest(upload, HOST)).toBe(false)
  })
})

describe('authorizeBlobRequest', () => {
  it('adds the bearer header', () => {
    const authorized = authorizeBlobRequest(
      new Request(`${HOST}/blobs/abc123`),
      'token-value',
    )
    expect(authorized.headers.get('Authorization')).toBe('Bearer token-value')
    expect(authorized.url).toBe(`${HOST}/blobs/abc123`)
    expect(authorized.method).toBe('GET')
  })

  it('keeps the range header a seeking audio element sent', () => {
    const authorized = authorizeBlobRequest(
      new Request(`${HOST}/blobs/abc123`, {
        headers: { Range: 'bytes=1024-2047', Accept: 'audio/*' },
      }),
      'token-value',
    )
    expect(authorized.headers.get('Range')).toBe('bytes=1024-2047')
    expect(authorized.headers.get('Accept')).toBe('audio/*')
  })

  it('replaces a stale authorization header rather than appending to it', () => {
    const authorized = authorizeBlobRequest(
      new Request(`${HOST}/blobs/abc123`, {
        headers: { Authorization: 'Bearer old-token' },
      }),
      'token-value',
    )
    expect(authorized.headers.get('Authorization')).toBe('Bearer token-value')
  })
})
