import { mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createInterface } from 'node:readline'
import { Repo, type AutomergeUrl } from '@automerge/automerge-repo'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import {
  startSyncServer,
  stopSyncServer,
} from '../../electron-client/src/syncServer'
import type {
  BlobDescriptor,
  RecordingData,
  RecordingRepoState,
} from '@tapes-monorepo/core'
import { HOST_PORT, PAIRING_TOKEN } from './ports'

/**
 * The other device, as its own process. It runs the electron client's real
 * embedded sync server against a temporary storage directory. syncServer.ts
 * imports no electron APIs, so it runs under plain Node. host.ts drives this
 * over stdio, one JSON object per line in both directions.
 *
 * It is a child process rather than an import into the Playwright worker
 * because Playwright's CJS transform cannot load Automerge's wasm entry, and
 * because one test needs a host that can be killed while the guest watches.
 */

type Command =
  | { id: number; type: 'start' }
  | {
      id: number
      type: 'seed'
      name: string
      seconds: number
      frequency: number
      withBytes: boolean
    }
  | { id: number; type: 'objects' }
  | { id: number; type: 'stop' }
  | { id: number; type: 'restart' }
  | { id: number; type: 'dispose' }

type Paths = { root: string; blobRoot: string; storageRoot: string }

let disposing = false
let paths: Paths | undefined
let libraryUrl: AutomergeUrl | undefined
let peer: { repo: Repo; disconnect: () => void } | undefined

/**
 * A websocket peer of the host, standing in for the device these recordings
 * were made on. One per run and kept open: an Automerge peer that hangs up
 * immediately after a change cannot answer the host's side of the exchange,
 * and the desktop app it stands in for does not hang up either.
 */
async function connectAsPeer(): Promise<Repo> {
  if (peer) {
    return peer.repo
  }
  const adapter = new BrowserWebSocketClientAdapter(
    `ws://127.0.0.1:${HOST_PORT}/sync?t=${PAIRING_TOKEN}`,
  )
  const repo = new Repo({ network: [adapter] })
  await repo.networkSubsystem.whenReady()
  peer = { repo, disconnect: () => adapter.disconnect() }
  return repo
}

async function listen(where: Paths) {
  const info = await startSyncServer({
    storagePath: where.storageRoot,
    host: '127.0.0.1',
    port: HOST_PORT,
    peerId: 'e2e-host',
    blobStorePath: where.blobRoot,
    pairingToken: PAIRING_TOKEN,
  })
  if (info.port !== HOST_PORT) {
    // `startSyncServer` falls back to an OS-assigned port on EADDRINUSE, which
    // is not where the guest's dev server proxies. Fail loudly rather than run
    // the suite against a host nothing can reach.
    await stopSyncServer()
    throw new Error(
      `Port ${HOST_PORT} was taken (the host landed on ${info.port}). ` +
        'Something else is bound to it — a stale e2e run, most likely.',
    )
  }
  return info
}

async function start() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tapes-e2e-host-'))
  paths = {
    root,
    blobRoot: path.join(root, 'blobs'),
    storageRoot: path.join(root, 'automerge'),
  }
  await mkdir(paths.blobRoot, { recursive: true })
  await mkdir(paths.storageRoot, { recursive: true })

  const info = await listen(paths)

  // Created through a websocket peer rather than written into the server's
  // storage by hand: an Automerge document is a change graph, not a file
  // format a test should be forging, and syncing one in is exactly what a real
  // second device does.
  const repo = await connectAsPeer()
  const library = repo.create<RecordingRepoState>({ recordings: [] })
  libraryUrl = library.url
  await waitForStoredDoc(library.url)

  return { libraryUrl, blobRoot: paths.blobRoot, port: info.port }
}

/**
 * Puts a recording on the host the way the desktop app does: bytes into the
 * blob store over `/blobs`, a `RecordingData` doc pointing at them, and that
 * doc's url pushed onto the library. To a guest this is a tape it never
 * recorded.
 */
async function seed(command: Extract<Command, { type: 'seed' }>) {
  const repo = await connectAsPeer()

  const recording = repo.create<RecordingData>({
    // Filled in below: a document cannot know its own url until it exists.
    url: '' as AutomergeUrl,
    filename: `${command.name}.wav`,
    filepath: `${command.name}.wav`,
    name: command.name,
    duration: command.seconds * 1000,
    id: command.name,
  })
  recording.change((doc) => {
    doc.url = recording.url
  })

  const bytes = wavBytes(command.seconds, command.frequency)
  const descriptor = command.withBytes
    ? await upload(recording.url, bytes)
    : // A descriptor the host holds no bytes for. The document says where the
      // audio is addressed and `/blobs` answers 404, which is what a recording
      // whose upload never landed looks like from a guest.
      {
        hash: 'f'.repeat(64),
        size: bytes.byteLength,
        mimeType: 'audio/wav',
        ext: '.wav',
      }
  recording.change((doc) => {
    doc.blob = descriptor
  })

  const library = await repo.find<RecordingRepoState>(libraryUrl!)
  library.change((doc) => {
    doc.recordings.push(recording.url)
  })

  // The guest is about to be told this recording exists, so it has to be on
  // the host before the browser opens, not merely sent.
  await waitForStoredDoc(recording.url)
  return { url: recording.url, descriptor }
}

/** The `/blobs` upload a guest performs, run from here. */
async function upload(
  docUrl: string,
  // An ArrayBuffer rather than a Uint8Array: `fetch` accepts either at runtime,
  // but only the buffer is a `BodyInit` as far as the DOM types are concerned.
  bytes: ArrayBuffer,
): Promise<BlobDescriptor> {
  const response = await fetch(
    `http://127.0.0.1:${HOST_PORT}/blobs?doc=${encodeURIComponent(docUrl)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAIRING_TOKEN}`,
        'Content-Type': 'audio/wav',
      },
      body: bytes,
    },
  )
  if (!response.ok) {
    throw new Error(`Seeding a blob failed: ${response.status}`)
  }
  return (await response.json()) as BlobDescriptor
}

/** Every object the host is holding, by hash. */
async function objects(): Promise<{ hash: string; size: number }[]> {
  const root = path.join(paths!.blobRoot, 'objects')
  const found: { hash: string; size: number }[] = []
  let shards: string[]
  try {
    shards = await readdir(root)
  } catch {
    return found
  }
  for (const shard of shards) {
    for (const entry of await readdir(path.join(root, shard))) {
      const { size } = await stat(path.join(root, shard, entry))
      found.push({ hash: entry, size })
    }
  }
  return found
}

/**
 * Waits until the host has written this document to its own storage. A `flush`
 * on the peer would only prove the change left this process. The host's
 * storage adapter writing it is the first moment a guest is guaranteed an
 * answer. The adapter shards by the first two characters of the document id,
 * so this looks for that exact directory rather than counting entries, since
 * two documents whose ids share a prefix share a directory.
 */
async function waitForStoredDoc(url: AutomergeUrl): Promise<void> {
  const id = url.replace(/^automerge:/, '')
  const directory = path.join(paths!.storageRoot, id.slice(0, 2), id.slice(2))
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      await stat(directory)
      return
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`Host never stored the document at ${url}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

/**
 * A playable WAV of `seconds` of a sine tone.
 *
 * Real decodable audio rather than random bytes: the playback tests assert the
 * guest received something an `<audio>` element will actually decode, which is
 * the point of moving the bytes at all.
 */
function wavBytes(seconds: number, frequency: number): ArrayBuffer {
  const sampleRate = 8000
  const samples = Math.floor(sampleRate * seconds)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)

  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate)
    view.setInt16(44 + index * 2, value * 0x7fff, true)
  }

  return buffer
}

async function run(command: Command): Promise<unknown> {
  switch (command.type) {
    case 'start':
      return start()
    case 'seed':
      return seed(command)
    case 'objects':
      return objects()
    case 'stop':
      return stopSyncServer()
    case 'restart':
      return listen(paths!)
    case 'dispose':
      disposing = true
      peer?.disconnect()
      peer = undefined
      await stopSyncServer()
      if (paths) {
        await rm(paths.root, { recursive: true, force: true })
        paths = undefined
      }
      return null
  }
}

/**
 * Automerge saves sync state on a throttle, so a timer can still be pending
 * when the store is removed. That write fails with ENOENT from a background
 * timer and would take the process down before it answers the dispose. During
 * teardown these are swallowed so the suite is not stranded in `afterAll`.
 */
process.on('unhandledRejection', (reason) => {
  if (disposing) {
    return
  }
  throw reason
})

process.on('uncaughtException', (error) => {
  if (disposing) {
    return
  }
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`)
  process.exit(1)
})

// stdout is the protocol. The sync server logs the address it bound to, and
// anything else reaching this stream would arrive at `host.ts` as a line that
// is not JSON, so the app's own logging goes to stderr with everything else.
console.log = (...args: unknown[]) => {
  process.stderr.write(`${args.join(' ')}\n`)
}

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const command = JSON.parse(line) as Command
  void run(command).then(
    (result) => {
      process.stdout.write(`${JSON.stringify({ id: command.id, result })}\n`)
      if (command.type === 'dispose') {
        process.exit(0)
      }
    },
    (error: unknown) => {
      process.stdout.write(
        `${JSON.stringify({
          id: command.id,
          error: error instanceof Error ? error.message : String(error),
        })}\n`,
      )
    },
  )
})
