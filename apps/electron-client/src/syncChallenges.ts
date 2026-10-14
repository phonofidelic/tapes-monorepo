import crypto from 'crypto'
import type http from 'http'
import {
  checkSyncProof,
  decodeSignedStatement,
} from '@tapes-monorepo/provenance'
import {
  SYNC_CHALLENGE_PATH,
  SYNC_PROOF_PARAM,
  type SyncChallengeResponse,
} from '@tapes-monorepo/sync-protocol'
import { CORS_HEADERS, sendJson } from './httpResponses'
import { isAuthorized } from './tokenAuth'

/**
 * The one-time challenges a guest signs to prove it holds its device key when
 * it opens the sync socket. The route hands them out and the upgrade handler
 * consumes them.
 *
 * Only a guest with the pairing token can get one, but that is every guest, so
 * the store is capped. A flood of requests evicts the oldest challenges rather
 * than growing memory.
 */

/** Long enough to sign and connect, short enough that a leaked url is stale. */
export const DEFAULT_CHALLENGE_TTL_MS = 60_000

export const DEFAULT_MAX_CHALLENGES = 256

export type SyncChallengeStore = {
  issue(): string
  /**
   * Whether the challenge was issued here and is still fresh. It is removed
   * either way, so a proof over it works once.
   */
  consume(challenge: string): boolean
}

export function createSyncChallengeStore({
  ttlMs = DEFAULT_CHALLENGE_TTL_MS,
  maxChallenges = DEFAULT_MAX_CHALLENGES,
  now = Date.now,
}: {
  ttlMs?: number
  maxChallenges?: number
  now?: () => number
} = {}): SyncChallengeStore {
  // Insertion order is issue order, so the first key is always the oldest.
  const issuedAt = new Map<string, number>()

  return {
    issue() {
      while (issuedAt.size >= maxChallenges) {
        issuedAt.delete(issuedAt.keys().next().value as string)
      }
      const challenge = crypto.randomBytes(32).toString('base64url')
      issuedAt.set(challenge, now())
      return challenge
    },

    consume(challenge) {
      const at = issuedAt.get(challenge)
      issuedAt.delete(challenge)
      return at !== undefined && now() - at <= ttlMs
    },
  }
}

/** Answers `GET /challenge` with a fresh challenge for a paired guest. */
export function createSyncChallengeRequestHandler({
  challenges,
  token,
}: {
  challenges: SyncChallengeStore
  token?: string
}) {
  return async function handleSyncChallengeRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== SYNC_CHALLENGE_PATH) {
      return false
    }
    request.resume()

    const method = request.method ?? 'GET'
    if (method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS)
      response.end()
      return true
    }
    if (method !== 'GET') {
      response.writeHead(405, { ...CORS_HEADERS, Allow: 'GET,OPTIONS' })
      response.end()
      return true
    }
    if (!isAuthorized(request, url, token)) {
      sendJson(response, 401, { error: 'Unauthorized' })
      return true
    }

    const body: SyncChallengeResponse = { challenge: challenges.issue() }
    // A cached challenge would already be consumed.
    response.setHeader('Cache-Control', 'no-store')
    sendJson(response, 200, body)
    return true
  }
}

/**
 * The device key an upgrade request proves it holds, or undefined when it sent
 * no proof or one that does not hold up. The challenge is used up even when
 * the signature fails, so a proof cannot be retried.
 */
export async function readProvenDeviceKey(
  url: URL,
  challenges: SyncChallengeStore,
): Promise<string | undefined> {
  const encoded = url.searchParams.get(SYNC_PROOF_PARAM)
  const signed = encoded ? decodeSignedStatement(encoded) : undefined
  const challenge = (signed?.payload as { challenge?: unknown } | null)
    ?.challenge
  if (
    !signed ||
    typeof challenge !== 'string' ||
    !challenges.consume(challenge)
  ) {
    return undefined
  }
  return checkSyncProof(signed, challenge)
}
