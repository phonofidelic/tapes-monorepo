import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import {
  RECORDING_CLAIM_HEADER,
  checkSessionRecord,
  createRecordingClaim,
  createSyncProof,
  encodeSignedStatement,
  exportPublicKey,
  generateSigningKeyPair,
  statementAddress,
  type SessionRecord,
  type Signed,
} from '@tapes-monorepo/provenance'
import {
  syncChallengeUrl,
  withSyncProof,
  type SyncChallengeResponse,
} from '@tapes-monorepo/sync-protocol'
import { readStoredStatement } from './statementUpload'
import {
  closeSession,
  flushSessions,
  getBlobStore,
  getSyncConnections,
  onSyncConnectionsChange,
  openSession,
  startSyncServer,
  stopSyncServer,
  type SyncConnection,
} from './syncServer'

let storagePath: string | undefined

afterEach(async () => {
  // The session lives at module scope, so a test must not leave one open.
  await flushSessions()
  await stopSyncServer()
  if (storagePath) {
    await rm(storagePath, { recursive: true, force: true })
    storagePath = undefined
  }
})

async function startForTest(pairingToken?: string) {
  storagePath = await mkdtemp(path.join(tmpdir(), 'tapes-sync-'))
  return startSyncServer({
    storagePath,
    host: '127.0.0.1',
    // 0 lets the OS pick a free port so the suite never collides with a
    // running desktop app on the default port.
    port: 0,
    peerId: 'test-host',
    pairingToken,
  })
}

function connect(url: string, headers?: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, { headers })
    socket.on('open', () => {
      socket.close()
      resolve()
    })
    socket.on('error', reject)
  })
}

/** Opens a socket and leaves it open, for the tests that need it connected. */
function open(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.on('open', () => resolve(socket))
    socket.on('error', reject)
  })
}

describe('startSyncServer', () => {
  // The web client derives its sync URL as `<origin>/sync` in every mode
  // (see apps/web-client/src/main.tsx): in development Vite proxies that path
  // here, and in production this server receives it verbatim. That only works
  // because the WebSocket server is attached to the whole http server rather
  // than a route, so it must keep accepting the upgrade on a non-root path.
  it('accepts a sync socket on the /sync path', async () => {
    const info = await startForTest()

    await expect(connect(`${info.url}/sync`)).resolves.toBeUndefined()
  })

  it('accepts a sync socket on the root path', async () => {
    const info = await startForTest()

    await expect(connect(info.url)).resolves.toBeUndefined()
  })

  // The token is the only thing standing between a LAN peer and the whole
  // library, so an upgrade that does not carry it must never reach the repo.
  describe('with a pairing token', () => {
    const token = 'pairing-secret'

    it('rejects an upgrade with no token', async () => {
      const info = await startForTest(token)

      await expect(connect(`${info.url}/sync`)).rejects.toThrow('401')
    })

    it('rejects an upgrade with the wrong token', async () => {
      const info = await startForTest(token)

      await expect(connect(`${info.url}/sync?t=nope`)).rejects.toThrow('401')
    })

    // A browser cannot set headers on a WebSocket, so `?t=` is the form every
    // paired guest actually uses.
    it('accepts an upgrade carrying the token as a query parameter', async () => {
      const info = await startForTest(token)

      await expect(
        connect(`${info.url}/sync?t=${token}`),
      ).resolves.toBeUndefined()
    })

    it('accepts an upgrade carrying the token as a bearer header', async () => {
      const info = await startForTest(token)

      await expect(
        connect(`${info.url}/sync`, { authorization: `Bearer ${token}` }),
      ).resolves.toBeUndefined()
    })
  })
})

// The name is read on the upgrade request, so the host has one for every
// connection it accepts.
describe('guest device labels', () => {
  it('names a guest by the label on its upgrade request', async () => {
    const info = await startForTest()
    const logged = vi.spyOn(console, 'info').mockImplementation(() => {})

    await connect(`${info.url}/sync?d=Studio%20iPad`)

    expect(logged).toHaveBeenCalledWith('Sync guest connected: Studio iPad')
    logged.mockRestore()
  })

  it('names a guest that sent nothing usable', async () => {
    const info = await startForTest()
    const logged = vi.spyOn(console, 'info').mockImplementation(() => {})

    await connect(`${info.url}/sync?d=%20`)

    expect(logged).toHaveBeenCalledWith('Sync guest connected: Unnamed device')
    logged.mockRestore()
  })

  // A guest chooses this string, and it lands in a log line.
  it('strips control characters out of a label before logging it', async () => {
    const info = await startForTest()
    const logged = vi.spyOn(console, 'info').mockImplementation(() => {})
    const forged = encodeURIComponent(
      `iPad${String.fromCharCode(0x0a)}Sync guest connected: host`,
    )

    await connect(`${info.url}/sync?d=${forged}`)

    expect(logged).toHaveBeenCalledWith(
      'Sync guest connected: iPad Sync guest connected: host',
    )
    logged.mockRestore()
  })
})

// The host has to answer "who is connected right now" without polling, and the
// answer has to empty out when a device goes away.
describe('connected devices', () => {
  it('lists a guest while its socket is open', async () => {
    const info = await startForTest()

    const socket = await open(`${info.url}/sync?d=Studio%20iPad`)

    expect(getSyncConnections()).toEqual([
      {
        id: expect.any(String),
        label: 'Studio iPad',
        address: expect.any(String),
        connectedAt: expect.any(Number),
        self: false,
      },
    ])
    socket.close()
  })

  it('lists a guest that sent no name without one', async () => {
    const info = await startForTest()

    const socket = await open(`${info.url}/sync`)

    expect(getSyncConnections()[0].label).toBeUndefined()
    socket.close()
  })

  it('drops a guest when its socket closes', async () => {
    const info = await startForTest()
    const socket = await open(`${info.url}/sync?d=Studio%20iPad`)

    socket.close()

    await vi.waitFor(() => expect(getSyncConnections()).toEqual([]))
  })

  it('lists nothing when no server is running', async () => {
    const info = await startForTest()
    const socket = await open(`${info.url}/sync`)

    await stopSyncServer()
    socket.terminate()

    expect(getSyncConnections()).toEqual([])
  })

  // The host's own window connects here too. Listing it as a guest would tell
  // the user a device is paired when none is.
  it("marks the host's own client", async () => {
    const info = await startForTest()

    const socket = await open(`${info.url}/sync?h=1&d=Desk%20Mac`)

    expect(getSyncConnections()[0]).toMatchObject({
      label: 'Desk Mac',
      self: true,
    })
    socket.close()
  })

  it('tells a listener about connects and disconnects', async () => {
    const info = await startForTest()
    const seen: SyncConnection[][] = []
    const unsubscribe = onSyncConnectionsChange((connections) =>
      seen.push(connections),
    )

    const socket = await open(`${info.url}/sync?d=Studio%20iPad`)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    socket.close()
    await vi.waitFor(() => expect(seen).toHaveLength(2))

    expect(seen[0].map((connection) => connection.label)).toEqual([
      'Studio iPad',
    ])
    expect(seen[1]).toEqual([])
    unsubscribe()
  })

  // Subscriptions are set up once, and the LAN and HTTPS toggles both restart
  // the server underneath them.
  it('keeps a listener across a restart of the server', async () => {
    let info = await startForTest()
    const seen: SyncConnection[][] = []
    const unsubscribe = onSyncConnectionsChange((connections) =>
      seen.push(connections),
    )
    await stopSyncServer()
    seen.length = 0

    info = await startForTest()
    const socket = await open(`${info.url}/sync?d=Studio%20iPad`)
    await vi.waitFor(() => expect(seen).toHaveLength(1))

    expect(seen[0]).toHaveLength(1)
    socket.close()
    unsubscribe()
  })
})

describe('session records', () => {
  const TOKEN = 'secret'
  const DOC = 'automerge:root'

  async function startWithStore(hostKey: CryptoKeyPair) {
    storagePath = await mkdtemp(path.join(tmpdir(), 'tapes-sync-'))
    return startSyncServer({
      storagePath,
      blobStorePath: path.join(storagePath, 'blobs'),
      host: '127.0.0.1',
      port: 0,
      peerId: 'test-host',
      pairingToken: TOKEN,
      loadSigningKey: async () => hostKey,
    })
  }

  /** What a guest does before it opens the socket. */
  async function provenUrl(syncUrl: string, keyPair: CryptoKeyPair) {
    const response = await fetch(syncChallengeUrl(syncUrl), {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const { challenge } = (await response.json()) as SyncChallengeResponse
    const proof = await createSyncProof(challenge, keyPair)
    return withSyncProof(syncUrl, encodeSignedStatement(proof))
  }

  async function upload(
    baseUrl: string,
    sessionId: string,
    key: CryptoKeyPair,
  ) {
    const audio = 'session take'
    const claim = await createRecordingClaim(
      {
        blob: {
          hash: createHash('sha256').update(audio).digest('hex'),
          size: audio.length,
          mimeType: 'audio/wav',
        },
        startedAt: '2026-10-14T10:00:00.000Z',
        endedAt: '2026-10-14T10:01:00.000Z',
        sessionId,
      },
      key,
    )
    const response = await fetch(
      `${baseUrl}/blobs?doc=${encodeURIComponent('automerge:take')}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'audio/wav',
          [RECORDING_CLAIM_HEADER]: encodeSignedStatement(claim),
        },
        body: audio,
      },
    )
    expect(response.ok).toBe(true)
    return statementAddress(claim)
  }

  it('lists a guest under the device key it proved', async () => {
    const info = await startWithStore(await generateSigningKeyPair())
    const guestKey = await generateSigningKeyPair()
    const syncUrl = `${info.url}/sync?t=${TOKEN}&d=Phone`

    const socket = await open(await provenUrl(syncUrl, guestKey))

    expect(getSyncConnections()[0].deviceKey).toBe(
      await exportPublicKey(guestKey.publicKey),
    )
    socket.close()
  })

  it('serves a guest without a proof, but under no key', async () => {
    const info = await startWithStore(await generateSigningKeyPair())

    const socket = await open(`${info.url}/sync?t=${TOKEN}&d=Phone`)

    expect(getSyncConnections()[0].deviceKey).toBeUndefined()
    socket.close()
  })

  it('lists the host window under the host key', async () => {
    const hostKey = await generateSigningKeyPair()
    const info = await startWithStore(hostKey)

    const socket = await open(`${info.url}/sync?t=${TOKEN}&h=1`)

    expect(getSyncConnections()[0].deviceKey).toBe(
      await exportPublicKey(hostKey.publicKey),
    )
    socket.close()
  })

  it('refuses a challenge without the pairing token', async () => {
    const info = await startWithStore(await generateSigningKeyPair())

    const response = await fetch(syncChallengeUrl(info.url))

    expect(response.status).toBe(401)
  })

  it('signs the devices and claims of a session', async () => {
    const hostKey = await generateSigningKeyPair()
    const info = await startWithStore(hostKey)
    const guestKey = await generateSigningKeyPair()
    openSession({ sessionId: 'session-1', docUrl: DOC })
    const socket = await open(
      await provenUrl(`${info.url}/sync?t=${TOKEN}&d=Phone`, guestKey),
    )
    const baseUrl = info.url.replace('ws:', 'http:')
    const accepted = await upload(baseUrl, 'session-1', guestKey)

    const pending = closeSession()
    await flushSessions()
    const hash = await pending
    socket.close()

    const stored = await readStoredStatement(getBlobStore()!, hash!)
    const check = await checkSessionRecord(stored!)
    expect(check.ok).toBe(true)
    const record = (stored as Signed<SessionRecord>).payload
    expect(record).toMatchObject({
      sessionId: 'session-1',
      hostKey: await exportPublicKey(hostKey.publicKey),
      claims: [accepted],
      devices: [
        {
          deviceKey: await exportPublicKey(guestKey.publicKey),
          label: 'Phone',
        },
      ],
    })
    expect(await getBlobStore()!.refs(hash!)).toEqual([DOC])
  })
})
