import crypto from 'crypto'
import http from 'http'
import path from 'path'
import { mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRecordingClaim,
  decodeSignedStatement,
  encodeSignedStatement,
  exportPublicKey,
  generateSigningKeyPair,
  RECORDING_CLAIM_HEADER,
  statementAddress,
  verifyStatement,
  type HostReceipt,
  type Signed,
} from '@tapes-monorepo/provenance'
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
  vi.restoreAllMocks()
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
  options: {
    withBundle?: boolean
    withStore?: boolean
    loadSigningKey?: () => Promise<CryptoKeyPair>
  } = {},
): Promise<Host> {
  const { withBundle = false, withStore = true, loadSigningKey } = options
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
    loadSigningKey,
  })

  return { origin: `http://127.0.0.1:${info.port}`, blobRoot }
}

function upload(
  origin: string,
  body: string,
  init: {
    token?: string | null
    contentType?: string
    doc?: string
    claim?: string
  } = {},
) {
  const { token = TOKEN, contentType = 'audio/wav', doc = DOC, claim } = init
  const query = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  return fetch(`${origin}/blobs${query}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': contentType,
      ...(claim ? { [RECORDING_CLAIM_HEADER]: claim } : {}),
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

describe('recording claims on upload', () => {
  const claimOver = async (
    bytes: string,
    device: CryptoKeyPair,
  ): Promise<string> =>
    encodeSignedStatement(
      await createRecordingClaim(
        {
          blob: {
            hash: crypto.createHash('sha256').update(bytes).digest('hex'),
            size: bytes.length,
            mimeType: 'audio/wav',
          },
          startedAt: '2026-10-05T12:00:00.000Z',
          endedAt: '2026-10-05T12:03:00.000Z',
        },
        device,
      ),
    )

  it('reports an upload without a claim as unsigned', async () => {
    const { origin } = await startHost({
      loadSigningKey: generateSigningKeyPair,
    })

    const response = await upload(origin, AUDIO)

    await expect(response.json()).resolves.toMatchObject({
      claim: { status: 'unsigned' },
    })
  })

  it('answers a valid claim with a receipt signed by the host', async () => {
    const hostKey = await generateSigningKeyPair()
    const { origin } = await startHost({ loadSigningKey: async () => hostKey })
    const claim = await claimOver(AUDIO, await generateSigningKeyPair())

    const response = await upload(origin, AUDIO, { claim })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      claim: { status: string; receipt: string }
    }
    expect(body.claim.status).toBe('verified')
    const receipt = decodeSignedStatement(
      body.claim.receipt,
    ) as Signed<HostReceipt>
    expect(await verifyStatement(receipt, hostKey.publicKey)).toBe(true)
    expect(receipt.payload).toMatchObject({
      type: 'tapes/receipt@1',
      claim: await statementAddress(decodeSignedStatement(claim)!),
      hostKey: await exportPublicKey(hostKey.publicKey),
    })
  })

  it('keeps the audio when the claim covers other bytes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { origin } = await startHost({
      loadSigningKey: generateSigningKeyPair,
    })
    const claim = await claimOver(
      'different audio',
      await generateSigningKeyPair(),
    )

    const response = await upload(origin, AUDIO, { claim })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      hash: AUDIO_HASH,
      claim: { status: 'unverified', problem: 'hash-mismatch' },
    })
    const stored = await fetch(`${origin}/blobs/${AUDIO_HASH}`, {
      headers: authed(),
    })
    expect(await stored.text()).toBe(AUDIO)
  })

  it('reports a header that is not a claim as malformed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { origin } = await startHost({
      loadSigningKey: generateSigningKeyPair,
    })

    const response = await upload(origin, AUDIO, { claim: 'not-a-claim' })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      claim: { status: 'unverified', problem: 'malformed' },
    })
  })

  it('stores the claim and receipt so a guest can fetch and verify them', async () => {
    const hostKey = await generateSigningKeyPair()
    const { origin } = await startHost({ loadSigningKey: async () => hostKey })
    const claim = await claimOver(AUDIO, await generateSigningKeyPair())

    const response = await upload(origin, AUDIO, { claim })
    const body = (await response.json()) as {
      claim: { receipt: string }
      attestations: string[]
    }

    const signedClaim = decodeSignedStatement(claim)!
    const receipt = decodeSignedStatement(body.claim.receipt)!
    expect(body.attestations).toEqual([
      await statementAddress(signedClaim),
      await statementAddress(receipt),
    ])

    const fetched = await fetch(`${origin}/blobs/${body.attestations[1]}`, {
      headers: authed(),
    })
    expect(fetched.status).toBe(200)
    expect(fetched.headers.get('content-type')).toBe('application/json')
    const stored = (await fetched.json()) as Signed<HostReceipt>
    expect(stored).toEqual(receipt)
    expect(await verifyStatement(stored, hostKey.publicKey)).toBe(true)
  })

  it('stores nothing for a claim that does not verify', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { origin } = await startHost({
      loadSigningKey: generateSigningKeyPair,
    })
    const claim = await claimOver(
      'different audio',
      await generateSigningKeyPair(),
    )

    const response = await upload(origin, AUDIO, { claim })

    await expect(response.json()).resolves.toMatchObject({ attestations: [] })
  })

  it('verifies the claim without a receipt when the host key fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { origin } = await startHost({
      loadSigningKey: () =>
        Promise.reject(new Error('safeStorage unavailable')),
    })
    const claim = await claimOver(AUDIO, await generateSigningKeyPair())

    const response = await upload(origin, AUDIO, { claim })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      claim: { status: string }
      attestations: string[]
    }
    expect(body.claim.status).toBe('verified')
    // The claim alone is still worth keeping.
    expect(body.attestations).toEqual([
      await statementAddress(decodeSignedStatement(claim)!),
    ])
  })
})

describe('repeat uploads of one claim', () => {
  type ClaimAnswer = {
    claim: { status: string; receipt: string }
    attestations: string[]
  }

  const claimOverAudio = async () =>
    encodeSignedStatement(
      await createRecordingClaim(
        {
          blob: { hash: AUDIO_HASH, size: AUDIO.length, mimeType: 'audio/wav' },
          startedAt: '2026-10-05T12:00:00.000Z',
          endedAt: '2026-10-05T12:03:00.000Z',
        },
        await generateSigningKeyPair(),
      ),
    )

  // A later upload must read a later clock, or a fresh receipt would come out
  // byte-identical to the first and the test could not tell them apart.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

  const send = async (
    origin: string,
    claim: string,
    doc = DOC,
  ): Promise<ClaimAnswer> =>
    (await (await upload(origin, AUDIO, { claim, doc })).json()) as ClaimAnswer

  it('answers a retry with the first receipt', async () => {
    const hostKey = await generateSigningKeyPair()
    const { origin } = await startHost({ loadSigningKey: async () => hostKey })
    const claim = await claimOverAudio()

    const first = await send(origin, claim)
    await tick()
    const retry = await send(origin, claim)

    expect(retry.claim.receipt).toBe(first.claim.receipt)
    expect(retry.attestations).toEqual(first.attestations)
  })

  it('answers concurrent uploads with one receipt', async () => {
    const hostKey = await generateSigningKeyPair()
    const { origin } = await startHost({ loadSigningKey: async () => hostKey })
    const claim = await claimOverAudio()

    const [a, b] = await Promise.all([send(origin, claim), send(origin, claim)])

    expect(a.claim.receipt).toBe(b.claim.receipt)
  })

  it('adds a second document as an owner of the reused receipt', async () => {
    const hostKey = await generateSigningKeyPair()
    const { origin, blobRoot } = await startHost({
      loadSigningKey: async () => hostKey,
    })
    const claim = await claimOverAudio()

    const first = await send(origin, claim, DOC)
    await tick()
    const second = await send(origin, claim, 'automerge:doc-b')

    expect(second.attestations).toEqual(first.attestations)
    const store = createBlobStore(blobRoot)
    expect(await store.refs(first.attestations[1])).toEqual([
      DOC,
      'automerge:doc-b',
    ])
  })

  it('signs a new receipt after the host key changes', async () => {
    const keys = [
      await generateSigningKeyPair(),
      await generateSigningKeyPair(),
    ]
    let current = 0
    const { origin } = await startHost({
      loadSigningKey: async () => keys[current],
    })
    const claim = await claimOverAudio()

    const first = await send(origin, claim)
    current = 1
    await tick()
    const second = await send(origin, claim)

    expect(second.claim.receipt).not.toBe(first.claim.receipt)
    const receipt = decodeSignedStatement(second.claim.receipt)!
    expect(await verifyStatement(receipt, keys[1].publicKey)).toBe(true)
  })

  it('signs a new receipt when the first was removed from the store', async () => {
    const hostKey = await generateSigningKeyPair()
    const { origin, blobRoot } = await startHost({
      loadSigningKey: async () => hostKey,
    })
    const claim = await claimOverAudio()

    const first = await send(origin, claim)
    await createBlobStore(blobRoot).remove(first.attestations[1])
    await tick()
    const second = await send(origin, claim)

    expect(second.claim.receipt).not.toBe(first.claim.receipt)
    const fetched = await fetch(`${origin}/blobs/${second.attestations[1]}`, {
      headers: authed(),
    })
    expect(fetched.status).toBe(200)
  })
})
