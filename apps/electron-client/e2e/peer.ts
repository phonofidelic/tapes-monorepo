import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import type { BlobDescriptor } from '@tapes-monorepo/core'

/**
 * The test process's handle on a peer of the app under test — the near side of
 * a one-JSON-object-per-line conversation with `peerProcess.mts`, which explains
 * why it is a separate process at all.
 */

export type PeerRecording = {
  url: AutomergeUrl
  name: string
  filepath: string
  duration: number
  blob?: BlobDescriptor
}

let child: ChildProcessWithoutNullStreams | undefined
let nextId = 1
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()

function send<T>(command: Record<string, unknown>): Promise<T> {
  if (!child) {
    throw new Error('The peer process is not running')
  }
  const id = nextId++
  const settled = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
  })
  child.stdin.write(`${JSON.stringify({ ...command, id })}\n`)
  return settled
}

/**
 * Joins the app's library as a websocket peer.
 *
 * Node runs the child's TypeScript itself, in `--experimental-transform-types`
 * mode rather than the default strip-only one, because these sources reach
 * package code written with constructor parameter properties.
 */
export async function startPeer(options: { syncUrl: string }): Promise<void> {
  child = spawn(
    process.execPath,
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      // `.mts`, and `__dirname` rather than `import.meta.url`: Playwright loads
      // this file as CommonJS (the workspace is not `type: module`), while the
      // child must run as ESM — Automerge ships no usable CommonJS entry.
      path.join(__dirname, 'peerProcess.mts'),
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

  // Whatever the peer logs is worth having in a failing run; a stack trace from
  // it would otherwise vanish into a closed pipe.
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[peer] ${chunk.toString()}`)
  })

  // A run that dies before `disposePeer` would otherwise leave this hanging off
  // the app's socket.
  const orphan = child
  process.once('exit', () => orphan.kill())

  // A peer that dies mid-command would otherwise leave the suite waiting on a
  // reply that is never coming, until the hook times out.
  child.on('exit', (code) => {
    for (const [, waiting] of pending) {
      waiting.reject(new Error(`The peer process exited (code ${code})`))
    }
    pending.clear()
  })

  await send<null>({ type: 'connect', url: options.syncUrl })
}

/** Every recording on the library, as the document holds it. */
export function peerRecordings(
  libraryUrl: AutomergeUrl,
): Promise<PeerRecording[]> {
  return send<PeerRecording[]>({ type: 'recordings', libraryUrl })
}

/**
 * Waits for a named recording to reach this peer with its blob descriptor
 * attached — the exact change PR #295's bug prevented from ever happening.
 */
export function awaitRecording(options: {
  libraryUrl: AutomergeUrl
  name: string
  withDescriptor?: boolean
  timeoutMs?: number
}): Promise<PeerRecording> {
  return send<PeerRecording>({
    type: 'awaitRecording',
    libraryUrl: options.libraryUrl,
    name: options.name,
    withDescriptor: options.withDescriptor ?? true,
    timeoutMs: options.timeoutMs ?? 30_000,
  })
}

export async function disposePeer(): Promise<void> {
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
