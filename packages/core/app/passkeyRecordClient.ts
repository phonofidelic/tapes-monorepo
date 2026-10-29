import {
  PASSKEY_RECORDS_PATH,
  PASSKEY_RECORD_FETCH_PATH,
  SYNC_CHALLENGE_PATH,
  type PasskeyRecordBody,
  type PasskeyRecordFetchBody,
  type PasskeyRecordFetchResponse,
  type PasskeyRecordResponse,
  type SyncChallengeResponse,
} from '@tapes-monorepo/sync-protocol'
import { personKeyServiceToken } from '@tapes-monorepo/provenance'
import { authHeaders, type BlobEndpoint } from '@/blobClient'
import type { CeremonyOutcome } from '@/personKeyCeremony'
import { callWorker } from '@/workerClient'

/**
 * A web guest's side of the passkey records its host keeps. One call puts a
 * record there, the other fetches it back onto a phone that has nothing else.
 *
 * The worker wraps the person key and signs the write. The page does the
 * ceremony and the HTTP, so the PRF output passes through here. It is used to
 * derive the fetch token and then cleared by the caller.
 */

/** What a ceremony returned, as both calls need it. */
type Passkey = Extract<CeremonyOutcome, { ok: true }>

export type RecordResult =
  | { ok: true; passkeyRecordedAt: string }
  | { ok: false; problem: 'unreachable' | 'refused'; detail?: string }

/**
 * Wraps this device's person key with the passkey and leaves the record on
 * the host. The host checks the write against its roster, so the person must
 * have joined it.
 */
export async function storePasskeyRecord(
  worker: Worker,
  endpoint: BlobEndpoint,
  passkey: Passkey,
  fetchImpl: typeof fetch = fetch,
): Promise<RecordResult> {
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

  const body = await callWorker<PasskeyRecordBody>(
    worker,
    'person:passkey-record',
    {
      prf: passkey.prf,
      rpId: passkey.rpId,
      credentialId: passkey.credentialId,
      challenge,
    },
  )

  let response: Response
  try {
    response = await fetchImpl(`${endpoint.baseUrl}${PASSKEY_RECORDS_PATH}`, {
      method: 'POST',
      headers: { ...authHeaders(endpoint), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, problem: 'unreachable' }
  }
  const answer = (await response.json().catch(() => undefined)) as
    PasskeyRecordResponse | undefined
  if (!response.ok || !answer?.ok) {
    return {
      ok: false,
      problem: 'refused',
      detail: answer && !answer.ok ? answer.error : undefined,
    }
  }
  return {
    ok: true,
    ...(await callWorker<{ passkeyRecordedAt: string }>(
      worker,
      'person:mark-record',
    )),
  }
}

export type FetchRecordResult =
  | { ok: true; record: string }
  | { ok: false; problem: 'unreachable' | 'no-record' }

/**
 * The record this host holds for the passkey that just answered. A wrong
 * token and an unknown credential id look the same, so there is one answer
 * for both.
 */
export async function fetchPasskeyRecord(
  endpoint: BlobEndpoint,
  passkey: Passkey,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchRecordResult> {
  const body: PasskeyRecordFetchBody = {
    credentialId: passkey.credentialId,
    token: await personKeyServiceToken(passkey.prf),
  }
  let response: Response
  try {
    response = await fetchImpl(
      `${endpoint.baseUrl}${PASSKEY_RECORD_FETCH_PATH}`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(endpoint),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )
  } catch {
    return { ok: false, problem: 'unreachable' }
  }
  if (response.status >= 500) {
    return { ok: false, problem: 'unreachable' }
  }
  const answer = (await response.json().catch(() => undefined)) as
    PasskeyRecordFetchResponse | undefined
  return answer?.ok
    ? { ok: true, record: answer.record }
    : { ok: false, problem: 'no-record' }
}
