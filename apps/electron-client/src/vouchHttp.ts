import type http from 'http'
import {
  decodeSignedStatement,
  encodeSignedStatement,
} from '@tapes-monorepo/provenance'
import {
  PIN_CHANGE_PATH,
  ROSTER_PATH,
  VOUCH_STATE_PATH,
  VOUCHES_PATH,
  type JoinBody,
  type PinBody,
  type PinChangeBody,
  type PinChangeResponse,
  type PinResponse,
  type RosterResponse,
  type VouchRequestBody,
  type VouchRequestResponse,
  type VouchStatus,
} from '@tapes-monorepo/sync-protocol'
import { BlobTooLargeError } from './blobStore'
import { CORS_HEADERS, sendJson, sendStatus } from './httpResponses'
import type { HostVouching } from './hostVouching'
import { readStatementBody } from './statementUpload'
import { isAuthorized } from './tokenAuth'

/**
 * The roster and vouch routes: joining the roster, changing a PIN, asking for
 * a vouch, reading or answering that request, and reading whether a vouch the
 * host signed still stands. Guarded by the pairing token like every other
 * route on this origin.
 *
 * The operator's side, such as confirming a request or unlocking a PIN, is not
 * here. It runs in the host's own window over IPC, never over the LAN.
 */

/** A join body holds a statement and a certificate. A few KB at most. */
const MAX_BODY_BYTES = 16 * 1024

export function createVouchRequestHandler({
  vouching,
  token,
}: {
  vouching: HostVouching
  token?: string
}) {
  return async function handleVouchRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const route = matchRoute(url.pathname)
    if (!route) {
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
    // Every answer depends on state that changes by the second.
    response.setHeader('Cache-Control', 'no-store')

    if (route.kind === 'roster' && method === 'GET') {
      request.resume()
      const body: RosterResponse = { people: await vouching.roster() }
      sendJson(response, 200, body)
      return true
    }
    if (route.kind === 'vouch-state' && method === 'GET') {
      request.resume()
      const state = await vouching.signedVouchState(route.address)
      if (!state) {
        sendJson(response, 404, { error: 'unknown-vouch' })
        return true
      }
      sendJson(response, 200, state)
      return true
    }
    if (route.kind === 'status' && method === 'GET') {
      request.resume()
      const status = vouching.status(route.id)
      if (!status) {
        sendJson(response, 404, { error: 'unknown-request' })
        return true
      }
      const body: VouchStatus =
        status.status === 'vouched'
          ? { status: 'vouched', vouch: encodeSignedStatement(status.vouch) }
          : { status: status.status }
      sendJson(response, 200, body)
      return true
    }
    const readOnly = route.kind === 'status' || route.kind === 'vouch-state'
    if (method !== 'POST' || readOnly) {
      request.resume()
      response.writeHead(405, {
        ...CORS_HEADERS,
        Allow:
          route.kind === 'roster'
            ? 'GET,POST,OPTIONS'
            : readOnly
              ? 'GET,OPTIONS'
              : 'POST,OPTIONS',
      })
      response.end()
      return true
    }

    const body = await readJsonBody(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'malformed' })
      return true
    }
    if (route.kind === 'roster') {
      await join(body as Partial<JoinBody>, response)
    } else if (route.kind === 'pin-change') {
      await changePin(body as Partial<PinChangeBody>, response)
    } else if (route.kind === 'requests') {
      await requestVouch(body as Partial<VouchRequestBody>, response)
    } else {
      await enterPin(route.id, body as Partial<PinBody>, response)
    }
    return true
  }

  async function join(body: Partial<JoinBody>, response: http.ServerResponse) {
    const join =
      typeof body.join === 'string' ? decodeSignedStatement(body.join) : null
    const certificate =
      typeof body.certificate === 'string'
        ? decodeSignedStatement(body.certificate)
        : null
    if (!join || !certificate) {
      sendJson(response, 400, { error: 'malformed' })
      return
    }
    const result = await vouching.join(join, certificate, body.pin)
    if (result.ok) {
      sendStatus(response, 204)
    } else {
      sendJson(response, 400, { error: result.error })
    }
  }

  async function requestVouch(
    body: Partial<VouchRequestBody>,
    response: http.ServerResponse,
  ) {
    const signed =
      typeof body.request === 'string'
        ? decodeSignedStatement(body.request)
        : null
    if (!signed) {
      sendJson(response, 400, { error: 'malformed' })
      return
    }
    const result = await vouching.request(signed)
    if (result.ok) {
      const answer: VouchRequestResponse = { id: result.id }
      sendJson(response, 201, answer)
      return
    }
    const status =
      result.error === 'unknown-person'
        ? 404
        : result.error === 'too-many-pending'
          ? 429
          : 400
    sendJson(response, status, { error: result.error })
  }

  async function changePin(
    body: Partial<PinChangeBody>,
    response: http.ServerResponse,
  ) {
    if (
      typeof body.personKey !== 'string' ||
      typeof body.oldPin !== 'string' ||
      body.pin === undefined
    ) {
      const answer: PinChangeResponse = { ok: false, error: 'malformed' }
      sendJson(response, 400, answer)
      return
    }
    const result: PinChangeResponse = await vouching.changePin(
      body.personKey,
      body.oldPin,
      body.pin,
    )
    const status = result.ok
      ? 200
      : result.error === 'unknown-person'
        ? 404
        : result.error === 'wrong-pin' || result.error === 'locked'
          ? 403
          : 400
    sendJson(response, status, result)
  }

  async function enterPin(
    id: string,
    body: Partial<PinBody>,
    response: http.ServerResponse,
  ) {
    const result = await vouching.enterPin(
      id,
      typeof body.pin === 'string' ? body.pin : '',
    )
    const answer: PinResponse = result.ok
      ? { ok: true, vouch: encodeSignedStatement(result.vouch) }
      : result
    const status = result.ok
      ? 200
      : result.error === 'not-pending'
        ? 409
        : result.error === 'no-pin'
          ? 400
          : 403
    sendJson(response, status, answer)
  }
}

type Route =
  | { kind: 'roster' }
  | { kind: 'pin-change' }
  | { kind: 'requests' }
  | { kind: 'vouch-state'; address: string }
  | { kind: 'status'; id: string }
  | { kind: 'pin'; id: string }

function matchRoute(pathname: string): Route | undefined {
  if (pathname === ROSTER_PATH) {
    return { kind: 'roster' }
  }
  if (pathname === PIN_CHANGE_PATH) {
    return { kind: 'pin-change' }
  }
  if (pathname === VOUCHES_PATH) {
    return { kind: 'requests' }
  }
  const state = new RegExp(`^${VOUCH_STATE_PATH}/([0-9a-f]{64})$`).exec(
    pathname,
  )
  if (state) {
    return { kind: 'vouch-state', address: state[1] }
  }
  const match = new RegExp(`^${VOUCHES_PATH}/([\\w-]+)(/pin)?$`).exec(pathname)
  if (!match) {
    return undefined
  }
  return match[2]
    ? { kind: 'pin', id: match[1] }
    : { kind: 'status', id: match[1] }
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
