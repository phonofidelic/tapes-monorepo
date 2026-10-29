import type http from 'http'
import {
  PASSKEY_RECORDS_PATH,
  PASSKEY_RECORD_FETCH_PATH,
  type PasskeyRecordBody,
  type PasskeyRecordFetchBody,
  type PasskeyRecordFetchResponse,
  type PasskeyRecordResponse,
} from '@tapes-monorepo/sync-protocol'
import { BlobTooLargeError } from './blobStore'
import type { PasskeyRecordStore } from './passkeyRecords'
import { CORS_HEADERS, sendJson } from './httpResponses'
import { readStatementBody } from './statementUpload'
import { isAuthorized } from './tokenAuth'

/**
 * The routes for a person's passkey records: one to store one, one to fetch
 * it back. Guarded by the pairing token like every other route on this
 * origin, with the store deciding everything else.
 *
 * Both are POSTs. The fetch carries the token the passkey derives, which
 * should not end up in a URL or a server log.
 */

/** A record is a few hundred bytes. This leaves room and no more. */
const MAX_BODY_BYTES = 8 * 1024

export function createPasskeyRecordHandler({
  records,
  token,
}: {
  records: PasskeyRecordStore
  token?: string
}) {
  return async function handlePasskeyRecordRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const fetching = url.pathname === PASSKEY_RECORD_FETCH_PATH
    if (!fetching && url.pathname !== PASSKEY_RECORDS_PATH) {
      return false
    }
    const method = request.method ?? 'GET'
    if (method === 'OPTIONS') {
      request.resume()
      response.writeHead(204, CORS_HEADERS)
      response.end()
      return true
    }
    if (!isAuthorized(request, url, token)) {
      request.resume()
      sendJson(response, 401, { error: 'Unauthorized' })
      return true
    }
    response.setHeader('Cache-Control', 'no-store')
    if (method !== 'POST') {
      request.resume()
      response.writeHead(405, { ...CORS_HEADERS, Allow: 'POST,OPTIONS' })
      response.end()
      return true
    }

    const body = await readJsonBody(request)
    if (!body) {
      const answer: PasskeyRecordResponse = { ok: false, error: 'malformed' }
      sendJson(response, 400, answer)
      return true
    }
    if (fetching) {
      await fetch(body as Partial<PasskeyRecordFetchBody>, response)
    } else {
      await store(body as Partial<PasskeyRecordBody>, response)
    }
    return true
  }

  async function store(
    body: Partial<PasskeyRecordBody>,
    response: http.ServerResponse,
  ) {
    if (
      typeof body.write !== 'string' ||
      typeof body.record !== 'string' ||
      typeof body.token !== 'string'
    ) {
      const answer: PasskeyRecordResponse = { ok: false, error: 'malformed' }
      sendJson(response, 400, answer)
      return
    }
    const result = await records.put(body.write, body.record, body.token)
    const status = result.ok
      ? 200
      : result.error === 'unknown-person'
        ? 404
        : result.error === 'not-yours'
          ? 403
          : result.error === 'too-many-records'
            ? 409
            : 400
    sendJson(response, status, result)
  }

  async function fetch(
    body: Partial<PasskeyRecordFetchBody>,
    response: http.ServerResponse,
  ) {
    if (
      typeof body.credentialId !== 'string' ||
      typeof body.token !== 'string'
    ) {
      const answer: PasskeyRecordFetchResponse = {
        ok: false,
        error: 'no-record',
      }
      sendJson(response, 404, answer)
      return
    }
    const result = await records.fetch(body.credentialId, body.token)
    sendJson(response, result.ok ? 200 : 404, result)
  }
}

async function readJsonBody(
  request: http.IncomingMessage,
): Promise<object | undefined> {
  try {
    const bytes = await readStatementBody(request, MAX_BODY_BYTES)
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch (error) {
    if (
      !(error instanceof BlobTooLargeError) &&
      !(error instanceof SyntaxError)
    ) {
      throw error
    }
    return undefined
  }
}
