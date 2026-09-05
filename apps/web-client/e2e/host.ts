import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import type { BlobDescriptor, RecordingAggregate } from '@tapes-monorepo/core'
import { HOST_PORT, PAIRING_TOKEN } from './ports'

/**
 * The test process's handle on the other device. The host itself, the electron
 * client's real embedded sync server, runs in a child process (hostProcess.ts
 * says why). Everything here is the near side of a one-JSON-object-per-line
 * conversation with it.
 */

// Re-exported so a spec needs only this module to reach the host.
export { HOST_PORT, PAIRING_TOKEN }

export const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`

export type SeededRecording = {
  url: AutomergeUrl
  descriptor: BlobDescriptor
}

let child: ChildProcessWithoutNullStreams | undefined
let nextId = 1
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()

function send<T>(command: Record<string, unknown>): Promise<T> {
  if (!child) {
    throw new Error('The host process is not running')
  }
  const id = nextId++
  const settled = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
  })
  child.stdin.write(`${JSON.stringify({ ...command, id })}\n`)
  return settled
}

/**
 * Starts the host and creates the library document guests pair with.
 *
 * Node runs the child directly: it strips the types itself, and a resolver hook
 * covers the extensionless relative imports the app's sources are written with
 * (see `tsExtensionHooks.mjs`). Nothing is built or bundled for this.
 */
export async function startHost(): Promise<{ libraryUrl: AutomergeUrl }> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  child = spawn(
    process.execPath,
    [
      // Node runs the TypeScript itself. `--experimental-transform-types`
      // rather than the default strip-only mode because the app's sources use
      // constructor parameter properties, which stripping alone cannot erase.
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--import',
      path.join(here, 'registerTsExtensions.mjs'),
      path.join(here, 'hostProcess.ts'),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line) as {
      id: number
      result?: unknown
      error?: string
    }
    const waiting = pending.get(message.id)
    pending.delete(message.id)
    if (!waiting) {
      return
    }
    if (message.error) {
      waiting.reject(new Error(message.error))
      return
    }
    waiting.resolve(message.result)
  })

  // Whatever the host logs is worth having in a failing run; a stack trace from
  // it would otherwise vanish into a closed pipe.
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[host] ${chunk.toString()}`)
  })

  // A run that dies before `disposeHost` would otherwise leave the port held,
  // and the next run fails on a mystery instead of starting.
  const orphan = child
  process.once('exit', () => orphan.kill())

  // A host that dies mid-command would otherwise leave the suite waiting on a
  // reply that is never coming, until the hook times out.
  child.on('exit', (code) => {
    for (const [, waiting] of pending) {
      waiting.reject(new Error(`The host process exited (code ${code})`))
    }
    pending.clear()
  })

  return send<{ libraryUrl: AutomergeUrl }>({ type: 'start' })
}

/**
 * Puts a recording on the host: bytes in its blob store, a document pointing at
 * them, and that document on the library. To a guest this is a tape it never
 * recorded.
 */
export function seedRecording(options: {
  name: string
  seconds: number
  frequency?: number
  /**
   * Set false to put the document on the library without uploading its bytes,
   * like a recording whose upload never landed. The host answers 404 for it
   * while staying reachable, which a guest must tell apart from the host being
   * away.
   */
  withBytes?: boolean
}): Promise<SeededRecording> {
  return send<SeededRecording>({
    type: 'seed',
    name: options.name,
    seconds: options.seconds,
    frequency: options.frequency ?? 440,
    withBytes: options.withBytes ?? true,
  })
}

/** Every object the host is holding, by hash. */
export function hostObjects(): Promise<{ hash: string; size: number }[]> {
  return send<{ hash: string; size: number }[]>({ type: 'objects' })
}

/** The library's recordings, by name and url, as the host has them. */
export function hostRecordings(): Promise<{ url: string; name: string }[]> {
  return send<{ url: string; name: string }[]>({ type: 'recordings' })
}

/**
 * What the host counts, read over the route the app reads.
 *
 * Straight HTTP rather than another stdio command. These numbers are only
 * worth asserting as a client can actually obtain them, and the token goes in
 * the query string for the reason `tokenAuth.ts` gives.
 */
export async function hostAggregates(): Promise<RecordingAggregate[]> {
  const response = await fetch(
    `${HOST_ORIGIN}/events/aggregates?t=${PAIRING_TOKEN}`,
  )
  if (!response.ok) {
    throw new Error(`Reading aggregates failed: ${response.status}`)
  }
  const body = (await response.json()) as { aggregates: RecordingAggregate[] }
  return body.aggregates
}

/** One recording's numbers, or undefined while the host has counted no play. */
export async function hostPlays(
  recordingUrl: string,
): Promise<RecordingAggregate | undefined> {
  return (await hostAggregates()).find(
    (aggregate) => aggregate.recordingUrl === recordingUrl,
  )
}

/** Takes the host off the network, leaving its storage in place. */
export function stopHost(): Promise<void> {
  return send<void>({ type: 'stop' })
}

/** Brings a stopped host back up on the same port, with the same storage. */
export function restartHost(): Promise<void> {
  return send<void>({ type: 'restart' })
}

export async function disposeHost(): Promise<void> {
  if (!child) {
    return
  }
  const dying = child
  try {
    await send<null>({ type: 'dispose' })
  } catch {
    // It was on its way out anyway; the kill below finishes the job.
  } finally {
    dying.kill()
    child = undefined
    pending.clear()
  }
}
