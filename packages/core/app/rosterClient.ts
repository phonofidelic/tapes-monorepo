import {
  ROSTER_PATH,
  SYNC_CHALLENGE_PATH,
  type JoinBody,
  type SyncChallengeResponse,
} from '@tapes-monorepo/sync-protocol'
import { authHeaders, type BlobEndpoint } from '@/blobClient'
import { callWorker } from '@/workerClient'

/**
 * Joins the host's roster of people from a web guest, so the host can later
 * vouch for a new device of theirs. The worker signs the join request with the
 * person key. The page sends it, with the PIN, which never reaches the worker.
 */

export type JoinResult =
  | { ok: true; joinedAt: string }
  /** The host did not answer, or answered with an error. */
  | { ok: false; problem: 'unreachable' | 'refused'; detail?: string }

export async function joinHostRoster(
  worker: Worker,
  endpoint: BlobEndpoint,
  details: { personName: string; pin?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<JoinResult> {
  let challenge: string
  try {
    const response = await fetchImpl(
      `${endpoint.baseUrl}${SYNC_CHALLENGE_PATH}`,
      { headers: authHeaders(endpoint), cache: 'no-store' },
    )
    if (!response.ok) {
      return { ok: false, problem: 'unreachable' }
    }
    challenge = ((await response.json()) as SyncChallengeResponse).challenge
  } catch {
    return { ok: false, problem: 'unreachable' }
  }

  const signed = await callWorker<{ join: string; certificate: string }>(
    worker,
    'person:sign-join',
    { challenge, personName: details.personName },
  )
  const body: JoinBody = {
    ...signed,
    ...(details.pin !== undefined && { pin: details.pin }),
  }

  let response: Response
  try {
    response = await fetchImpl(`${endpoint.baseUrl}${ROSTER_PATH}`, {
      method: 'POST',
      headers: { ...authHeaders(endpoint), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, problem: 'unreachable' }
  }
  if (!response.ok) {
    const answer = (await response.json().catch(() => undefined)) as
      { error?: unknown } | undefined
    return {
      ok: false,
      problem: 'refused',
      detail: typeof answer?.error === 'string' ? answer.error : undefined,
    }
  }
  return {
    ok: true,
    ...(await callWorker<{ joinedAt: string }>(worker, 'person:mark-joined')),
  }
}
