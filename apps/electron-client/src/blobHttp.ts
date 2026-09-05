import type http from 'http'
import { pipeline } from 'stream/promises'
import { BlobTooLargeError, isValidBlobHash, type BlobStore } from './blobStore'
import { isAuthorized } from './tokenAuth'
import { CORS_HEADERS, sendJson, sendStatus } from './httpResponses'

/**
 * The `/blobs` HTTP routes, served from the same origin and port as the sync
 * socket so a guest needs no second address and, over HTTPS, no second cert
 * exception.
 *
 * Must stay mounted ahead of the static handler in the sync server. Its SPA
 * fallback answers any unmatched path with index.html and a 200, so a blob
 * route behind it would hand the audio element HTML and fail as a decode error.
 */

export const BLOB_PATH_PREFIX = '/blobs'

/** Per-upload ceiling. Well above any plausible recording. A stop, not a policy. */
export const DEFAULT_MAX_BLOB_BYTES = 512 * 1024 * 1024

/** Whole-store ceiling, so a paired peer cannot fill the host's disk. */
export const DEFAULT_MAX_STORE_BYTES = 32 * 1024 * 1024 * 1024

export type BlobHandlerOptions = {
  store: BlobStore
  /**
   * Shared secret from `sync-server.json`, handed to guests through the
   * existing QR pairing URL. Absent only in tests that exercise the unguarded
   * shape.
   */
  token?: string
  maxBlobBytes?: number
  maxStoreBytes?: number
}

type ParsedRange =
  | { kind: 'ok'; start: number; end: number }
  | { kind: 'unsatisfiable' }
  | { kind: 'none' }

/**
 * Single-range `bytes=` parsing. A multi-range request is answered with the
 * whole body, which the spec permits and no audio element asks for.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ParsedRange {
  if (!header) {
    return { kind: 'none' }
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) {
    return { kind: 'none' }
  }
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') {
    return { kind: 'unsatisfiable' }
  }

  if (rawStart === '') {
    // Suffix form: the final N bytes.
    const suffix = Number(rawEnd)
    if (suffix === 0) {
      return { kind: 'unsatisfiable' }
    }
    const start = Math.max(0, size - suffix)
    return { kind: 'ok', start, end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) {
    return { kind: 'unsatisfiable' }
  }
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) {
    return { kind: 'unsatisfiable' }
  }
  return { kind: 'ok', start, end }
}

export function createBlobRequestHandler(options: BlobHandlerOptions) {
  const {
    store,
    token,
    maxBlobBytes = DEFAULT_MAX_BLOB_BYTES,
    maxStoreBytes = DEFAULT_MAX_STORE_BYTES,
  } = options

  async function handleUpload(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ) {
    const contentType = (request.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!contentType.startsWith('audio/')) {
      request.resume()
      sendJson(response, 415, { error: 'Expected an audio/* Content-Type' })
      return
    }

    const docUrl =
      url.searchParams.get('doc') ??
      (request.headers['x-tapes-recording-url'] as string | undefined)
    if (!docUrl) {
      request.resume()
      sendJson(response, 400, { error: 'Missing owning document url' })
      return
    }

    if ((await store.totalBytes()) >= maxStoreBytes) {
      request.resume()
      sendJson(response, 507, { error: 'Blob store is full' })
      return
    }

    try {
      const { meta, deduped } = await store.ingestStream(request, {
        mimeType: contentType,
        docUrl,
        maxBytes: maxBlobBytes,
      })
      sendJson(response, deduped ? 200 : 201, {
        hash: meta.hash,
        size: meta.size,
        mimeType: meta.mimeType,
        ext: meta.ext,
        deduped,
      })
    } catch (error) {
      if (error instanceof BlobTooLargeError) {
        sendJson(response, 413, { error: error.message })
        // The client may still be mid-upload; without this it would keep
        // pushing bytes at a socket that has already been answered.
        request.destroy()
        return
      }
      throw error
    }
  }

  async function handleDownload(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    hash: string,
    method: 'GET' | 'HEAD',
  ) {
    const meta = await store.stat(hash)
    if (!meta) {
      sendJson(response, 404, { error: 'Unknown blob' })
      return
    }

    const range = parseRange(request.headers.range, meta.size)
    if (range.kind === 'unsatisfiable') {
      response.writeHead(416, {
        ...CORS_HEADERS,
        'Content-Range': `bytes */${meta.size}`,
      })
      response.end()
      return
    }

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      'Content-Type': meta.mimeType,
      'Accept-Ranges': 'bytes',
      ETag: `"${meta.hash}"`,
      // Content addressing makes the body immutable by construction.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `inline; filename="${meta.hash}${meta.ext}"`,
    }

    if (range.kind === 'ok') {
      headers['Content-Length'] = String(range.end - range.start + 1)
      headers['Content-Range'] =
        `bytes ${range.start}-${range.end}/${meta.size}`
      response.writeHead(206, headers)
    } else {
      headers['Content-Length'] = String(meta.size)
      response.writeHead(200, headers)
    }

    if (method === 'HEAD') {
      response.end()
      return
    }

    const body =
      range.kind === 'ok'
        ? store.read(hash, { start: range.start, end: range.end })
        : store.read(hash)
    try {
      await pipeline(body, response)
    } catch {
      // Client hung up mid-stream; pipeline has already torn the read down.
      response.destroy()
    }
  }

  async function handleDelete(
    response: http.ServerResponse,
    url: URL,
    hash: string,
  ) {
    const docUrl = url.searchParams.get('doc')
    if (!docUrl) {
      sendJson(response, 400, { error: 'Missing owning document url' })
      return
    }
    if (!(await store.has(hash))) {
      sendJson(response, 404, { error: 'Unknown blob' })
      return
    }
    await store.releaseRef(hash, docUrl)
    sendStatus(response, 204)
  }

  /**
   * Returns true when the request was a blob request and has been answered, so
   * the caller knows not to fall through to the static handler.
   */
  return async function handleBlobRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const pathname = url.pathname
    if (
      pathname !== BLOB_PATH_PREFIX &&
      !pathname.startsWith(`${BLOB_PATH_PREFIX}/`)
    ) {
      return false
    }

    const method = request.method ?? 'GET'
    if (method === 'OPTIONS') {
      sendStatus(response, 204)
      return true
    }

    if (!isAuthorized(request, url, token)) {
      request.resume()
      sendJson(response, 401, { error: 'Unauthorized' })
      return true
    }

    try {
      if (pathname === BLOB_PATH_PREFIX) {
        if (method === 'POST') {
          await handleUpload(request, response, url)
        } else {
          sendJson(response, 405, { error: 'Method not allowed' })
        }
        return true
      }

      const hash = decodeURIComponent(
        pathname.slice(`${BLOB_PATH_PREFIX}/`.length),
      )
      if (!isValidBlobHash(hash)) {
        sendJson(response, 400, { error: 'Malformed blob hash' })
        return true
      }

      if (method === 'GET' || method === 'HEAD') {
        await handleDownload(request, response, hash, method)
      } else if (method === 'DELETE') {
        await handleDelete(response, url, hash)
      } else {
        sendJson(response, 405, { error: 'Method not allowed' })
      }
      return true
    } catch (error) {
      console.error('Blob request failed:', error)
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'Blob request failed' })
      } else {
        response.destroy()
      }
      return true
    }
  }
}
