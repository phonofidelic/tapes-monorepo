import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupToFileText,
  createDeviceCertificate,
  createJoinRequest,
  createPasskeyRecordWrite,
  encodeSignedStatement,
  exportPublicKey,
  generateSigningKeyPair,
  personKeyServiceToken,
  statementAddress,
  toBase64Url,
  wrapPersonKeyWithPasskey,
} from '@tapes-monorepo/provenance'
import {
  PASSKEY_RECORDS_PATH,
  PASSKEY_RECORD_FETCH_PATH,
  ROSTER_PATH,
  SYNC_CHALLENGE_PATH,
  type SyncChallengeResponse,
} from '@tapes-monorepo/sync-protocol'
import { startSyncServer, stopSyncServer } from './syncServer'

/**
 * The record routes over a real sync server, so the wiring, the pairing token
 * and the host's own challenges are all exercised together.
 */

const TOKEN = 'test-record-token'

let dir: string
let origin: string
const hostKeys = await generateSigningKeyPair()

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tapes-record-http-'))
  const info = await startSyncServer({
    storagePath: path.join(dir, 'sync'),
    host: '127.0.0.1',
    port: 0,
    peerId: 'test-host',
    pairingToken: TOKEN,
    computerName: 'Studio Mac',
    rosterPath: path.join(dir, 'people.json'),
    loadSigningKey: async () => hostKeys,
  })
  origin = `http://127.0.0.1:${info.port}`
})

afterEach(async () => {
  await stopSyncServer()
  await rm(dir, { recursive: true, force: true })
})

const send = (pathname: string, body?: unknown, token: string | null = TOKEN) =>
  fetch(`${origin}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function challenge(): Promise<string> {
  const response = await send(SYNC_CHALLENGE_PATH)
  return ((await response.json()) as SyncChallengeResponse).challenge
}

/** Joins the roster, then wraps that person's key with a passkey. */
async function joined() {
  const keyPair = await generateSigningKeyPair(true)
  const certificate = await createDeviceCertificate(
    {
      deviceKey: await exportPublicKey(
        (await generateSigningKeyPair()).publicKey,
      ),
      deviceLabel: 'Old phone',
    },
    keyPair,
  )
  const join = await createJoinRequest(
    {
      personName: 'Sam',
      certificate: await statementAddress(certificate),
      challenge: await challenge(),
    },
    keyPair,
  )
  const response = await send(ROSTER_PATH, {
    join: encodeSignedStatement(join),
    certificate: encodeSignedStatement(certificate),
  })
  expect(response.status).toBe(204)

  const secret = {
    prf: crypto.getRandomValues(new Uint8Array(32)),
    rpId: 'tapes.network',
    credentialId: toBase64Url(crypto.getRandomValues(new Uint8Array(20))),
  }
  const backup = await wrapPersonKeyWithPasskey(keyPair, secret)
  return {
    keyPair,
    secret,
    record: backupToFileText(backup),
    token: await personKeyServiceToken(secret.prf),
  }
}

async function body(person: Awaited<ReturnType<typeof joined>>) {
  const write = await createPasskeyRecordWrite(
    {
      credentialId: person.secret.credentialId,
      record: person.record,
      challenge: await challenge(),
    },
    person.keyPair,
  )
  return {
    write: encodeSignedStatement(write),
    record: person.record,
    token: person.token,
  }
}

describe('passkey record routes', () => {
  it('stores a record and hands it back for the same passkey', async () => {
    const person = await joined()

    const stored = await send(PASSKEY_RECORDS_PATH, await body(person))
    expect(stored.status).toBe(200)
    expect(await stored.json()).toEqual({ ok: true })

    const fetched = await send(PASSKEY_RECORD_FETCH_PATH, {
      credentialId: person.secret.credentialId,
      token: person.token,
    })
    expect(fetched.status).toBe(200)
    expect(await fetched.json()).toEqual({ ok: true, record: person.record })
  })

  it('answers 404 for a wrong token', async () => {
    const person = await joined()
    await send(PASSKEY_RECORDS_PATH, await body(person))

    const fetched = await send(PASSKEY_RECORD_FETCH_PATH, {
      credentialId: person.secret.credentialId,
      token: await personKeyServiceToken(
        crypto.getRandomValues(new Uint8Array(32)),
      ),
    })
    expect(fetched.status).toBe(404)
    expect(await fetched.json()).toEqual({ ok: false, error: 'no-record' })
  })

  it('answers 404 for a person who never joined', async () => {
    const stranger = await generateSigningKeyPair(true)
    const secret = {
      prf: crypto.getRandomValues(new Uint8Array(32)),
      rpId: 'tapes.network',
      credentialId: toBase64Url(crypto.getRandomValues(new Uint8Array(20))),
    }
    const record = backupToFileText(
      await wrapPersonKeyWithPasskey(stranger, secret),
    )
    const write = await createPasskeyRecordWrite(
      {
        credentialId: secret.credentialId,
        record,
        challenge: await challenge(),
      },
      stranger,
    )
    const response = await send(PASSKEY_RECORDS_PATH, {
      write: encodeSignedStatement(write),
      record,
      token: await personKeyServiceToken(secret.prf),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'unknown-person',
    })
  })

  it('needs the pairing token', async () => {
    const person = await joined()
    const stored = await send(
      PASSKEY_RECORDS_PATH,
      await body(person),
      'wrong-token',
    )
    expect(stored.status).toBe(401)

    const fetched = await send(
      PASSKEY_RECORD_FETCH_PATH,
      { credentialId: person.secret.credentialId, token: person.token },
      null,
    )
    expect(fetched.status).toBe(401)
  })

  it('refuses a malformed body and a GET', async () => {
    expect((await send(PASSKEY_RECORDS_PATH, { write: 1 })).status).toBe(400)
    expect((await send(PASSKEY_RECORD_FETCH_PATH, {})).status).toBe(404)

    const read = await send(PASSKEY_RECORDS_PATH)
    expect(read.status).toBe(405)
    expect(read.headers.get('Allow')).toBe('POST,OPTIONS')
  })

  it('never caches a record', async () => {
    const person = await joined()
    const stored = await send(PASSKEY_RECORDS_PATH, await body(person))
    expect(stored.headers.get('Cache-Control')).toBe('no-store')
  })
})
