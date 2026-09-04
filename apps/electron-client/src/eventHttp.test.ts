import http from 'http'
import path from 'path'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { startSyncServer, stopSyncServer } from './syncServer'
import { createEventStore } from './eventStore'
import { createEventRequestHandler, type IngestResponse } from './eventHttp'

const TOKEN = 'test-event-token'
/** Shaped like a real Automerge url; the route validates the shape. */
const RECORDING = 'automerge:2j9knpCseyhnK8izDmiqpZM7bJq'
const OTHER_RECORDING = 'automerge:4kLmNoPqRsTuVwXyZ1a2B3c4D5e'
const DEVICE = 'device-a'

const dirs: string[] = []
let extraServer: http.Server | undefined

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await stopSyncServer()
  if (extraServer) {
    await new Promise<void>((resolve) => extraServer!.close(() => resolve()))
    extraServer = undefined
  }
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

type EventBody = {
  id: string
  recordingUrl?: string
  type?: string
  completion?: unknown
  occurredAt?: string
  deviceId?: string
}

function event(overrides: Partial<EventBody> = {}): EventBody {
  return {
    id: 'event-1',
    recordingUrl: RECORDING,
    type: 'play',
    completion: 0.5,
    occurredAt: '2026-09-04T10:00:00.000Z',
    deviceId: DEVICE,
    ...overrides,
  }
}

function post(
  origin: string,
  body: unknown,
  init: { token?: string | null; contentType?: string } = {},
) {
  const { token = TOKEN, contentType = 'application/json' } = init
  return fetch(`${origin}/events`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': contentType,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** POSTs a single event over a caller-owned agent, resolving to the status. */
function postOverAgent(
  origin: string,
  agent: http.Agent,
  body: EventBody,
): Promise<number> {
  const payload = JSON.stringify({ events: [body] })
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${origin}/events`,
      {
        agent,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        // Drained so the socket is free for the next request on this agent.
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      },
    )
    request.on('error', reject)
    request.end(payload)
  })
}

/**
 * Writes the storage entry `NodeFSStorageAdapter` would have written for a
 * document, which is all the host's known-recording check looks at.
 */
async function seedRecording(storagePath: string, url: string) {
  const documentId = url.slice('automerge:'.length)
  const dir = path.join(
    storagePath,
    documentId.slice(0, 2),
    documentId.slice(2),
  )
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'snapshot'), 'pretend this is a chunk')
}

type Host = { origin: string; storagePath: string; eventRoot: string }

async function startHost(
  options: { withBundle?: boolean; withStore?: boolean } = {},
): Promise<Host> {
  const { withBundle = false, withStore = true } = options
  const storagePath = await tempDir('tapes-sync-')
  const eventRoot = await tempDir('tapes-events-')

  let webClientPath: string | undefined
  if (withBundle) {
    webClientPath = await tempDir('tapes-web-')
    await writeFile(
      path.join(webClientPath, 'index.html'),
      '<!doctype html><title>Tapes</title>',
    )
  }

  await seedRecording(storagePath, RECORDING)

  const info = await startSyncServer({
    storagePath,
    host: '127.0.0.1',
    port: 0,
    peerId: 'test-host',
    webClientPath,
    eventStorePath: withStore ? eventRoot : undefined,
    pairingToken: withStore ? TOKEN : undefined,
  })

  return { origin: `http://127.0.0.1:${info.port}`, storagePath, eventRoot }
}

/** The events written to the log, in order, across every day segment. */
async function loggedEvents(eventRoot: string) {
  const logDir = path.join(eventRoot, 'log')
  const segments = (await readdir(logDir)).sort()
  const events = []
  for (const segment of segments) {
    const contents = await readFile(path.join(logDir, segment), 'utf-8')
    for (const line of contents.split('\n').filter(Boolean)) {
      events.push(JSON.parse(line))
    }
  }
  return events
}

describe('event ingest', () => {
  it('rejects a batch with no token', async () => {
    const { origin } = await startHost()

    const response = await post(origin, { events: [event()] }, { token: null })

    expect(response.status).toBe(401)
  })

  it('accepts the token as a query parameter', async () => {
    const { origin } = await startHost()

    const response = await fetch(`${origin}/events?t=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [event()] }),
    })

    expect(response.status).toBe(200)
  })

  it('stores a valid batch and reports every id as accepted', async () => {
    const { origin, eventRoot } = await startHost()

    const response = await post(origin, {
      events: [
        event({ id: 'a' }),
        event({ id: 'b', completion: 1 }),
        event({ id: 'c', completion: 0 }),
      ],
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as IngestResponse
    expect(body).toEqual({
      accepted: ['a', 'b', 'c'],
      duplicates: [],
      rejected: [],
    })
    expect(await loggedEvents(eventRoot)).toHaveLength(3)
  })

  it('accepts a bare array as well as an envelope', async () => {
    const { origin } = await startHost()

    const response = await post(origin, [event({ id: 'bare' })])

    const body = (await response.json()) as IngestResponse
    expect(body.accepted).toEqual(['bare'])
  })

  it('clamps completion into [0, 1] rather than rejecting the play', async () => {
    const { origin, eventRoot } = await startHost()

    await post(origin, {
      events: [
        event({ id: 'over', completion: 1.02 }),
        event({ id: 'under', completion: -0.4 }),
      ],
    })

    const stored = await loggedEvents(eventRoot)
    expect(stored.map((entry) => entry.completion)).toEqual([1, 0])
  })

  it('stamps a host-clock receivedAt on each stored event', async () => {
    const { origin, eventRoot } = await startHost()

    await post(origin, { events: [event()] })

    const [stored] = await loggedEvents(eventRoot)
    expect(stored.occurredAt).toBe('2026-09-04T10:00:00.000Z')
    expect(Number.isNaN(Date.parse(stored.receivedAt))).toBe(false)
  })

  it('answers a partial batch per event', async () => {
    const { origin, eventRoot } = await startHost()

    const response = await post(origin, {
      events: [
        event({ id: 'ok-1' }),
        event({ id: 'bad-type', type: 'scrub' }),
        event({ id: 'ok-2' }),
        { id: 'no-completion', recordingUrl: RECORDING, type: 'play' },
      ],
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as IngestResponse
    expect(body.accepted).toEqual(['ok-1', 'ok-2'])
    expect(body.rejected).toEqual([
      { index: 1, id: 'bad-type', reason: 'malformed', retryable: false },
      { index: 3, id: 'no-completion', reason: 'malformed', retryable: false },
    ])
    expect(await loggedEvents(eventRoot)).toHaveLength(2)
  })

  it('reports an event with no usable id by its position', async () => {
    const { origin } = await startHost()

    const response = await post(origin, { events: [{ type: 'play' }, null] })

    const body = (await response.json()) as IngestResponse
    expect(body.rejected).toEqual([
      { index: 0, reason: 'malformed', retryable: false },
      { index: 1, reason: 'malformed', retryable: false },
    ])
  })

  it('rejects an event naming a recording the host does not hold', async () => {
    const { origin, eventRoot } = await startHost()

    const response = await post(origin, {
      events: [event({ id: 'unknown', recordingUrl: OTHER_RECORDING })],
    })

    const body = (await response.json()) as IngestResponse
    // Retryable: the document may simply not have synced here yet.
    expect(body.rejected).toEqual([
      { index: 0, id: 'unknown', reason: 'unknown-recording', retryable: true },
    ])
    expect(await loggedEvents(eventRoot).catch(() => [])).toHaveLength(0)
  })

  it('takes a recording that syncs to the host after the first attempt', async () => {
    const { origin, storagePath } = await startHost()

    const before = await post(origin, {
      events: [event({ id: 'late', recordingUrl: OTHER_RECORDING })],
    })
    await seedRecording(storagePath, OTHER_RECORDING)
    const after = await post(origin, {
      events: [event({ id: 'late', recordingUrl: OTHER_RECORDING })],
    })

    expect(((await before.json()) as IngestResponse).rejected).toHaveLength(1)
    expect(((await after.json()) as IngestResponse).accepted).toEqual(['late'])
  })

  it('counts a replayed flush once and names the duplicates', async () => {
    const { origin, eventRoot } = await startHost()
    const batch = { events: [event({ id: 'a' }), event({ id: 'b' })] }

    await post(origin, batch)
    const retry = await post(origin, batch)

    const body = (await retry.json()) as IngestResponse
    expect(body).toEqual({ accepted: [], duplicates: ['a', 'b'], rejected: [] })
    expect(await loggedEvents(eventRoot)).toHaveLength(2)
  })

  it('keeps two devices that mint the same id apart', async () => {
    const { origin, eventRoot } = await startHost()

    await post(origin, { events: [event({ id: '1', deviceId: 'phone' })] })
    const second = await post(origin, {
      events: [event({ id: '1', deviceId: 'laptop' })],
    })

    expect(((await second.json()) as IngestResponse).accepted).toEqual(['1'])
    expect(await loggedEvents(eventRoot)).toHaveLength(2)
  })

  it('survives a restart without re-admitting events already on disk', async () => {
    const { origin, storagePath, eventRoot } = await startHost()
    await post(origin, { events: [event({ id: 'a' })] })
    await stopSyncServer()

    const info = await startSyncServer({
      storagePath,
      host: '127.0.0.1',
      port: 0,
      peerId: 'test-host',
      eventStorePath: eventRoot,
      pairingToken: TOKEN,
    })
    const response = await post(`http://127.0.0.1:${info.port}`, {
      events: [event({ id: 'a' })],
    })

    expect(((await response.json()) as IngestResponse).duplicates).toEqual([
      'a',
    ])
    expect(await loggedEvents(eventRoot)).toHaveLength(1)
  })

  it('rejects a non-JSON content type and an unparseable body', async () => {
    const { origin } = await startHost()

    const wrongType = await post(
      origin,
      { events: [] },
      {
        contentType: 'text/plain',
      },
    )
    const garbage = await post(origin, 'not json at all')

    expect(wrongType.status).toBe(415)
    expect(garbage.status).toBe(400)
  })

  it('rejects a body that is not a list of events', async () => {
    const { origin } = await startHost()

    const response = await post(origin, { events: 'all of them' })

    expect(response.status).toBe(400)
  })

  it('answers anything but POST with 405', async () => {
    const { origin } = await startHost()

    const response = await fetch(`${origin}/events`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}` },
    })

    expect(response.status).toBe(405)
  })

  it('answers a CORS preflight without a token', async () => {
    const { origin } = await startHost()

    const response = await fetch(`${origin}/events`, { method: 'OPTIONS' })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('answers 503 when the host has no event store', async () => {
    const { origin } = await startHost({ withStore: false })

    const response = await post(origin, { events: [event()] }, { token: null })

    expect(response.status).toBe(503)
  })
})

describe('routing order', () => {
  // The static handler answers *any* unmatched path with index.html and a 200.
  // An ingest route mounted after it would tell a flushing client "accepted"
  // for events that were never written, and the queue would clear itself.
  it('answers /events itself rather than falling through to the SPA shell', async () => {
    const { origin } = await startHost({ withBundle: true })

    const response = await post(origin, { events: [event()] })

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(((await response.json()) as IngestResponse).accepted).toEqual([
      'event-1',
    ])
  })

  it('still serves the SPA shell for ordinary deep links', async () => {
    const { origin } = await startHost({ withBundle: true })

    const response = await fetch(`${origin}/some/deep/route`)

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('<title>Tapes</title>')
  })
})

describe('ingest limits', () => {
  // Driven through a bare server so the caps can be set to something a test
  // can reach, as `blobHttp.test.ts` does for upload sizes.
  async function startCappedHost(
    caps: {
      maxBatchEvents?: number
      maxBodyBytes?: number
      rateBurst?: number
      rateRefillPerSecond?: number
    } = {},
  ) {
    const eventRoot = await tempDir('tapes-events-')
    const store = createEventStore(eventRoot)
    await store.open()
    const handle = createEventRequestHandler({ store, token: TOKEN, ...caps })
    extraServer = http.createServer((request, response) => {
      void handle(request, response).then((handled) => {
        if (!handled) {
          response.writeHead(404)
          response.end()
        }
      })
    })
    const port = await new Promise<number>((resolve) => {
      extraServer!.listen(0, '127.0.0.1', () => {
        const address = extraServer!.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })
    return { origin: `http://127.0.0.1:${port}`, eventRoot }
  }

  it('refuses an oversized batch whole rather than truncating it', async () => {
    const { origin, eventRoot } = await startCappedHost({ maxBatchEvents: 2 })

    const response = await post(origin, {
      events: [event({ id: 'a' }), event({ id: 'b' }), event({ id: 'c' })],
    })

    expect(response.status).toBe(413)
    // Nothing partially taken: the client's whole batch is still retryable.
    await expect(readdir(path.join(eventRoot, 'log'))).resolves.toEqual([])
  })

  it('refuses a body past the byte ceiling', async () => {
    const { origin } = await startCappedHost({ maxBodyBytes: 64 })

    const response = await post(origin, {
      events: [event({ id: 'x'.repeat(200) })],
    })

    expect(response.status).toBe(413)
  })

  it('rate-limits a connection that loops', async () => {
    const { origin } = await startCappedHost({
      rateBurst: 2,
      rateRefillPerSecond: 1,
    })
    // `fetch` spreads requests over its own pool, which would put each one on
    // a fresh socket and a fresh bucket. A single-socket keep-alive agent is
    // what the limiter is actually about: one connection, looping.
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })

    const statuses: number[] = []
    for (const id of ['a', 'b', 'c', 'd']) {
      statuses.push(await postOverAgent(origin, agent, event({ id })))
    }
    agent.destroy()

    expect(statuses).toEqual([200, 200, 429, 429])
  })

  it('leaves an unauthorized caller unable to spend the budget', async () => {
    const { origin } = await startCappedHost({ rateBurst: 1 })

    const denied = await post(origin, { events: [event()] }, { token: 'wrong' })
    const allowed = await post(origin, { events: [event()] })

    expect(denied.status).toBe(401)
    expect(allowed.status).toBe(200)
  })
})
