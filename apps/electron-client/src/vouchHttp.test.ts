import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkDeviceVouch,
  createDeviceCertificate,
  createJoinRequest,
  createVouchRequest,
  decodeSignedStatement,
  encodeSignedStatement,
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
} from '@tapes-monorepo/provenance'
import {
  ROSTER_PATH,
  SYNC_CHALLENGE_PATH,
  VOUCHES_PATH,
  type SyncChallengeResponse,
} from '@tapes-monorepo/sync-protocol'
import {
  ConfirmVouchChannel,
  GetPendingVouchesChannel,
  RejectVouchChannel,
} from './channels/VouchChannels'
import type { PendingVouch } from './hostVouching'
import {
  getHostVouching,
  startSyncServer,
  stopSyncServer,
  subscribeToPendingVouches,
} from './syncServer'

const TOKEN = 'test-vouch-token'

let dir: string
let origin: string
const hostKeys = await generateSigningKeyPair()

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tapes-vouch-'))
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

/** Joins the roster as a new person and returns their person key. */
async function joinAs(name: string, pin?: string): Promise<string> {
  const personKeys = await generateSigningKeyPair()
  const certificate = await createDeviceCertificate(
    {
      deviceKey: await exportPublicKey(
        (await generateSigningKeyPair()).publicKey,
      ),
      deviceLabel: 'Old phone',
    },
    personKeys,
  )
  const join = await createJoinRequest(
    {
      personName: name,
      certificate: await statementAddress(certificate),
      challenge: await challenge(),
    },
    personKeys,
  )
  const response = await send(ROSTER_PATH, {
    join: encodeSignedStatement(join),
    certificate: encodeSignedStatement(certificate),
    pin,
  })
  expect(response.status).toBe(204)
  return exportPublicKey(personKeys.publicKey)
}

async function askForVouch(personKey: string): Promise<string> {
  const request = await createVouchRequest(
    { personKey, deviceLabel: 'New phone' },
    await generateSigningKeyPair(),
  )
  const response = await send(VOUCHES_PATH, {
    request: encodeSignedStatement(request),
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { id: string }).id
}

describe('roster and vouch routes', () => {
  it('lists people who joined', async () => {
    const personKey = await joinAs('Sam', '4821')

    const response = await send(ROSTER_PATH)

    expect(await response.json()).toEqual({
      people: [{ personKey, name: 'Sam', hasPin: true, pinLocked: false }],
    })
  })

  it('vouches for a new device after the right PIN', async () => {
    const id = await askForVouch(await joinAs('Sam', '4821'))

    const response = await send(`${VOUCHES_PATH}/${id}/pin`, { pin: '4821' })
    const body = (await response.json()) as { ok: true; vouch: string }

    expect(response.status).toBe(200)
    const vouch = decodeSignedStatement(body.vouch)!
    expect(await checkDeviceVouch(vouch)).toMatchObject({
      ok: true,
      vouch: {
        payload: {
          hostKey: await exportPublicKey(hostKeys.publicKey),
          hostLabel: 'Studio Mac',
          personName: 'Sam',
          method: 'pin',
        },
      },
    })
    expect(await (await send(`${VOUCHES_PATH}/${id}`)).json()).toEqual({
      status: 'vouched',
      vouch: body.vouch,
    })
  })

  it('tells the guest how many PIN tries are left', async () => {
    const id = await askForVouch(await joinAs('Sam', '4821'))

    const response = await send(`${VOUCHES_PATH}/${id}/pin`, { pin: '0000' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'wrong-pin',
      attemptsLeft: 4,
    })
  })

  it('waits for the operator when the guest has no PIN', async () => {
    const id = await askForVouch(await joinAs('Sam'))
    expect(await (await send(`${VOUCHES_PATH}/${id}`)).json()).toEqual({
      status: 'pending',
    })

    await getHostVouching()!.confirm(id)

    expect(await (await send(`${VOUCHES_PATH}/${id}`)).json()).toMatchObject({
      status: 'vouched',
    })
  })

  it('refuses a request for someone not on the roster', async () => {
    const stranger = await exportPublicKey(
      (await generateSigningKeyPair()).publicKey,
    )
    const request = await createVouchRequest(
      { personKey: stranger, deviceLabel: 'New phone' },
      await generateSigningKeyPair(),
    )

    const response = await send(VOUCHES_PATH, {
      request: encodeSignedStatement(request),
    })

    expect(response.status).toBe(404)
  })

  it('refuses a guest without the pairing token', async () => {
    expect((await send(ROSTER_PATH, undefined, null)).status).toBe(401)
    expect((await send(VOUCHES_PATH, {}, 'wrong')).status).toBe(401)
  })

  it('refuses a body that is not JSON', async () => {
    const response = await fetch(`${origin}${ROSTER_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: 'not json',
    })

    expect(response.status).toBe(400)
  })
})

describe("the operator's channels", () => {
  it('lists a waiting device and confirms it, telling the window each time', async () => {
    const pushed: PendingVouch[][] = []
    const stop = subscribeToPendingVouches((pending) => pushed.push(pending))
    try {
      const id = await askForVouch(await joinAs('Sam'))

      expect(new GetPendingVouchesChannel().handle()).toMatchObject({
        success: true,
        data: {
          pending: [{ id, personName: 'Sam', deviceLabel: 'New phone' }],
        },
      })
      expect(await new ConfirmVouchChannel().handle({ data: { id } })).toEqual({
        success: true,
      })
      expect(pushed.map((list) => list.length)).toEqual([1, 0])
      expect(await (await send(`${VOUCHES_PATH}/${id}`)).json()).toMatchObject({
        status: 'vouched',
      })
    } finally {
      stop()
    }
  })

  it('rejects a waiting device', async () => {
    const id = await askForVouch(await joinAs('Sam'))

    expect(new RejectVouchChannel().handle({ data: { id } })).toEqual({
      success: true,
    })
    expect(await (await send(`${VOUCHES_PATH}/${id}`)).json()).toEqual({
      status: 'rejected',
    })
  })

  it('says a request that is no longer waiting cannot be confirmed', async () => {
    expect(
      await new ConfirmVouchChannel().handle({ data: { id: 'gone' } }),
    ).toMatchObject({ success: false })
  })
})
