import {
  ROSTER_PATH,
  SYNC_CHALLENGE_PATH,
  VOUCHES_PATH,
  type JoinBody,
  type PinResponse,
  type RosterPerson,
  type RosterResponse,
  type SyncChallengeResponse,
  type VouchRequestResponse,
  type VouchStatus,
} from '@tapes-monorepo/sync-protocol'
import { authHeaders, type BlobEndpoint } from '@/blobClient'
import type { PersonKeyStatus } from '@/personKey'
import { callWorker } from '@/workerClient'

/**
 * A web guest's side of the host's roster. On first join the guest joins the
 * roster, so the host can later vouch for a new device of the person's. A
 * guest that lost its keys asks for that vouch instead.
 *
 * The worker signs with the person key or the device key. The page talks to
 * the host, and the PIN goes from the page to the host without reaching the
 * worker.
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

/**
 * The people on the host's roster. Empty when the host has none, or serves no
 * roster, such as a host without a signing key.
 */
export async function fetchRoster(
  endpoint: BlobEndpoint,
  fetchImpl: typeof fetch = fetch,
): Promise<RosterPerson[]> {
  const response = await fetchImpl(`${endpoint.baseUrl}${ROSTER_PATH}`, {
    headers: authHeaders(endpoint),
    cache: 'no-store',
  })
  if (response.status === 404) {
    return []
  }
  if (!response.ok) {
    throw new Error(`The host's roster answered ${response.status}`)
  }
  return ((await response.json()) as RosterResponse).people
}

/** Asks the host to vouch for this device as `personKey`. Returns the id. */
export async function askForVouch(
  worker: Worker,
  endpoint: BlobEndpoint,
  details: { personKey: string; deviceLabel: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { request } = await callWorker<{ request: string }>(
    worker,
    'person:request-vouch',
    details,
  )
  const response = await fetchImpl(`${endpoint.baseUrl}${VOUCHES_PATH}`, {
    method: 'POST',
    headers: { ...authHeaders(endpoint), 'Content-Type': 'application/json' },
    body: JSON.stringify({ request }),
  })
  if (!response.ok) {
    throw new Error(`The host refused the vouch request: ${response.status}`)
  }
  return ((await response.json()) as VouchRequestResponse).id
}

/** Where a vouch request stands. Undefined once the host has forgotten it. */
export async function readVouchStatus(
  endpoint: BlobEndpoint,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VouchStatus | undefined> {
  const response = await fetchImpl(
    `${endpoint.baseUrl}${VOUCHES_PATH}/${encodeURIComponent(id)}`,
    { headers: authHeaders(endpoint), cache: 'no-store' },
  )
  if (response.status === 404) {
    return undefined
  }
  if (!response.ok) {
    throw new Error(`The vouch request answered ${response.status}`)
  }
  return (await response.json()) as VouchStatus
}

/** Tries a PIN for a waiting request. The host counts wrong ones per person. */
export async function tryPin(
  endpoint: BlobEndpoint,
  id: string,
  pin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PinResponse> {
  const response = await fetchImpl(
    `${endpoint.baseUrl}${VOUCHES_PATH}/${encodeURIComponent(id)}/pin`,
    {
      method: 'POST',
      headers: { ...authHeaders(endpoint), 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    },
  )
  return (await response.json()) as PinResponse
}

export type VouchAcceptance =
  | { ok: true; status: PersonKeyStatus }
  | {
      ok: false
      problem: 'bad-vouch' | 'no-pinned-host' | 'other-host' | 'other-device'
    }

/**
 * Hands the host's vouch to the worker, which keeps it only if the pinned host
 * signed it for this device.
 */
export function acceptVouch(
  worker: Worker,
  vouch: string,
  pinnedHostKey: string | undefined,
): Promise<VouchAcceptance> {
  return callWorker(worker, 'person:accept-vouch', {
    vouch,
    ...(pinnedHostKey && { pinnedHostKey }),
  })
}
