import crypto from 'crypto'
import http from 'http'
import path from 'path'
import { mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { startSyncServer, stopSyncServer } from './syncServer'
import { createBlobStore } from './blobStore'
import { createBlobRequestHandler } from './blobHttp'

const TOKEN = 'test-blob-token'
const DOC = 'automerge:doc-a'
const AUDIO = 'pretend this is a wav file'
const AUDIO_HASH = crypto.createHash('sha256').update(AUDIO).digest('hex')

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

type Host = { origin: string; blobRoot: string }

async function startHost(
  options: { withBundle?: boolean; withStore?: boolean } = {},
): Promise<Host> {
  const { withBundle = false, withStore = true } = options
  const storagePath = await tempDir('tapes-sync-')
  const blobRoot = await tempDir('tapes-blobs-')

  let webClientPath: string | undefined
  if (withBundle) {
    webClientPath = await tempDir('tapes-web-')
    await writeFile(
      path.join(webClientPath, 'index.html'),
      '<!doctype html><title>Tapes</title>',
    )
  }

  const info = await startSyncServer({
    storagePath,
    host: '127.0.0.1',
    port: 0,
    peerId: 'test-host',
    webClientPath,
    blobStorePath: withStore ? blobRoot : undefined,
    pairingToken: withStore ? TOKEN : undefined,
  })

  return { origin: `http://127.0.0.1:${info.port}`, blobRoot }
}

function upload(
  origin: string,
  body: string,
  init: { token?: string | null; contentType?: string; doc?: string } = {},
) {
  const { token = TOKEN, contentType = 'audio/wav', doc = DOC } = init
  const query = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  return fetch(`${origin}/blobs${query}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': contentType,
    },
    body,
  })
}

const authed = (token: string | null = TOKEN) =>
  token ? { Authorization: `Bearer ${token}` } : undefined

describe('blob routes', () => {
  it('advertises its origin and token on the server info', async () => {
    const storagePath = await tempDir('tapes-sync-')
    const blobRoot = await tempDir('tapes-blobs-')

    const info = await startSyncServer({
      storagePath,
      host: '127.0.0.1',
      port: 0,
      peerId: 'test-host',
      blobStorePath: blobRoot,
      pairingToken: TOKEN,
    })

    expect(info.blobBaseUrl).toBe(`http://127.0.0.1:${info.port}`)
    expect(info.pairingToken).toBe(TOKEN)
  })

  it('rejects an upload with no token', async () => {
    const { origin } = await startHost()

    const response = await upload(origin, AUDIO, { token: null })

    expect(response.status).toBe(401)
  })

  it('stores an upload under the sha-256 of its bytes', async () => {
    const { origin } = await startHost()

    const response = await upload(origin, AUDIO)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      hash: AUDIO_HASH,
      size: AUDIO.length,
      mimeType: 'audio/wav',
      ext: '.wav',
      deduped: false,
    })
  })

  it('dedups a re-upload of identical bytes', async () => {
    const { origin, blobRoot } = await startHost()
    await upload(origin, AUDIO)

    const response = await upload(origin, AUDIO, { doc: 'automerge:doc-b' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ deduped: true })
    const shard = AUDIO_HASH.slice(0, 2)
    expect(await readdir(path.join(blobRoot, 'objects', shard))).toHaveLength(1)
  })

  it('rejects a non-audio content type', async () => {
    const { origin } = await startHost()

    const response = await upload(origin, AUDIO, { contentType: 'text/plain' })

    expect(response.status).toBe(415)
  })

  it('rejects an upload with no owning document', async () => {
    const { origin } = await startHost()

    const response = await upload(origin, AUDIO, { doc: '' })

    expect(response.status).toBe(400)
  })

  it('serves the stored bytes with cache and range headers', async () => {
    const { origin } = await startHost()
    await upload(origin, AUDIO)

    const response = await fetch(`${origin}/blobs/${AUDIO_HASH}`, {
      headers: authed(),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/wav')
    expect(response.headers.get('content-length')).toBe(String(AUDIO.length))
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('etag')).toBe(`"${AUDIO_HASH}"`)
    await expect(response.text()).resolves.toBe(AUDIO)
  })

  it('accepts the token as a query parameter', async () => {
    const { origin } = await startHost()
    await upload(origin, AUDIO)

    const response = await fetch(`${origin}/blobs/${AUDIO_HASH}?t=${TOKEN}`)

    expect(response.status).toBe(200)
  })

  it('answers a range request with a partial body', async () => {
    const { origin } = await startHost()
    await upload(origin, AUDIO)

    const response = await fetch(`${origin}/blobs/${AUDIO_HASH}`, {
      headers: { ...authed(), Range: 'bytes=0-9' },
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-length')).toBe('10')
    expect(response.headers.get('content-range')).toBe(
      `bytes 0-9/${AUDIO.length}`,
    )
    await expect(response.text()).resolves.toBe(AUDIO.slice(0, 10))
  })

  it('answers an unsatisfiable range with 416', async () => {
    const { origin } = await startHost()
    await upload(origin, AUDIO)

    const response = await fetch(`${origin}/blobs/${AUDIO_HASH}`, {
      headers: { ...authed(), Range: 'bytes=99999-' },
    })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe(
      `bytes */${AUDIO.length}`,
    )
  })

  it('answers HEAD with headers and no body', async () => {
    const { origin } = await startHost()
    await upload(origin, AUDIO)

    const response = await fetch(`${origin}/blobs/${AUDIO_HASH}`, {
      method: 'HEAD',
      headers: authed(),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(AUDIO.length))
    await expect(response.text()).resolves.toBe('')
  })

  it('404s an unknown hash and 400s a malformed one', async () => {
    const { origin } = await startHost()
    const unknown = 'a'.repeat(64)

    const missing = await fetch(`${origin}/blobs/${unknown}`, {
      headers: authed(),
    })
    const malformed = await fetch(`${origin}/blobs/not-a-hash`, {
      headers: authed(),
    })

    expect(missing.status).toBe(404)
    expect(malformed.status).toBe(400)
  })

  it('releases the bytes when the last owner deletes', async () => {
    const { origin } = await startHost()
    await upload(origin, AUDIO)

    const response = await fetch(
      `${origin}/blobs/${AUDIO_HASH}?doc=${encodeURIComponent(DOC)}`,
      { method: 'DELETE', headers: authed() },
    )

    expect(response.status).toBe(204)
    const after = await fetch(`${origin}/blobs/${AUDIO_HASH}`, {
      headers: authed(),
    })
    expect(after.status).toBe(404)
  })

  it('keeps the bytes while another document still references them', async () => {
    const { origin } = await startHost()
    await upload(origin, AUDIO)
    await upload(origin, AUDIO, { doc: 'automerge:doc-b' })

    await fetch(
      `${origin}/blobs/${AUDIO_HASH}?doc=${encodeURIComponent(DOC)}`,
      {
        method: 'DELETE',
        headers: authed(),
      },
    )

    const after = await fetch(`${origin}/blobs/${AUDIO_HASH}`, {
      headers: authed(),
    })
    expect(after.status).toBe(200)
  })

  it('answers 503 when the host has no blob store', async () => {
    const { origin } = await startHost({ withStore: false })

    const response = await fetch(`${origin}/blobs/${AUDIO_HASH}`)

    expect(response.status).toBe(503)
  })
})

describe('routing order', () => {
  // The static handler answers *any* unmatched path with index.html and a 200.
  // A blob route mounted after it would therefore hand an <audio> element a
  // page of HTML instead of returning 404, which surfaces as an opaque decode
  // error. These two assertions are the guard on that ordering.
  it('404s an unknown blob rather than falling through to the SPA shell', async () => {
    const { origin } = await startHost({ withBundle: true })

    const response = await fetch(`${origin}/blobs/${'b'.repeat(64)}`, {
      headers: authed(),
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('still serves the SPA shell for ordinary deep links', async () => {
    const { origin } = await startHost({ withBundle: true })

    const response = await fetch(`${origin}/some/deep/route`)

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('<title>Tapes</title>')
  })
})

describe('upload limits', () => {
  // Driven through a bare server so the caps can be set to something a test
  // can reach without moving hundreds of megabytes.
  async function startCappedHost(caps: {
    maxBlobBytes?: number
    maxStoreBytes?: number
  }) {
    const blobRoot = await tempDir('tapes-blobs-')
    const handle = createBlobRequestHandler({
      store: createBlobStore(blobRoot),
      token: TOKEN,
      ...caps,
    })
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
    return { origin: `http://127.0.0.1:${port}`, blobRoot }
  }

  it('rejects an oversized upload and leaves no temp file', async () => {
    const { origin, blobRoot } = await startCappedHost({ maxBlobBytes: 8 })

    const response = await upload(origin, 'far more than eight bytes')

    expect(response.status).toBe(413)
    expect(await readdir(path.join(blobRoot, 'tmp'))).toEqual([])
  })

  it('refuses uploads once the store budget is spent', async () => {
    const { origin } = await startCappedHost({ maxStoreBytes: 4 })

    const response = await upload(origin, AUDIO)
    expect(response.status).toBe(201)

    const second = await upload(origin, 'different audio bytes', {
      doc: 'automerge:doc-b',
    })
    expect(second.status).toBe(507)
  })
})
