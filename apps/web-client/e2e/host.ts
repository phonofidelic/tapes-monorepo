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
 *
 * Most specs use the module functions, which drive one host on `HOST_PORT`.
 * A spec that needs a second host makes a `Host` on another port.
 */

// Re-exported so a spec needs only this module to reach the host.
export { HOST_PORT, PAIRING_TOKEN }

export const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`

export type SeededRecording = {
  url: AutomergeUrl
  descriptor: BlobDescriptor
  /** Hashes of the claim and receipt the host stored, as the doc lists them. */
  statements: string[]
}

export type HostOptions = {
  /**
   * Directory of a built web-client bundle for the host to serve over its own
   * origin. Without one the host answers API routes only, and a guest loads
   * the app from a Vite server instead.
   */
  webClientPath?: string
  /** Gives the host a signing key, so it answers a verified claim with a receipt. */
  signs?: boolean
}

export type SeedOptions = {
  name: string
  seconds: number
  frequency?: number
  /**
   * Set false to add the document to the root document without uploading its
   * bytes, like a recording whose upload never landed. The host answers 404
   * for it while staying reachable, which a guest must tell apart from the
   * host being away.
   */
  withBytes?: boolean
  /**
   * Uploads with a signed recording claim, as a guest does at stop. A host
   * with a signing key stores the claim and a receipt next to the audio.
   */
  withClaim?: boolean
}

/** Every object the host is holding, by hash. */
export type HostObject = { hash: string; size: number; mimeType?: string }

/**
 * One host process. Every host takes the same pairing token, because a guest
 * presents a single token to every host it knows.
 */
export class Host {
  readonly origin: string
  private child: ChildProcessWithoutNullStreams | undefined
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  constructor(readonly port: number = HOST_PORT) {
    this.origin = `http://127.0.0.1:${port}`
  }

  private send<T>(command: Record<string, unknown>): Promise<T> {
    if (!this.child) {
      throw new Error('The host process is not running')
    }
    const id = this.nextId++
    const settled = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
    })
    this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`)
    return settled
  }

  /**
   * Starts the host and creates the root document guests pair with.
   *
   * Node runs the child directly: it strips the types itself, and a resolver
   * hook covers the extensionless relative imports the app's sources are
   * written with (see `tsExtensionHooks.mjs`). Nothing is built or bundled
   * for this.
   */
  async start(
    options: HostOptions = {},
  ): Promise<{ libraryUrl: AutomergeUrl }> {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const child = spawn(
      process.execPath,
      [
        // Node runs the TypeScript itself. `--experimental-transform-types`
        // rather than the default strip-only mode because the app's sources
        // use constructor parameter properties, which stripping alone cannot
        // erase.
        '--experimental-transform-types',
        '--disable-warning=ExperimentalWarning',
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--import',
        path.join(here, 'registerTsExtensions.mjs'),
        path.join(here, 'hostProcess.ts'),
        String(this.port),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    this.child = child

    createInterface({ input: child.stdout }).on('line', (line) => {
      const message = JSON.parse(line) as {
        id: number
        result?: unknown
        error?: string
      }
      const waiting = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (!waiting) {
        return
      }
      if (message.error) {
        waiting.reject(new Error(message.error))
        return
      }
      waiting.resolve(message.result)
    })

    // Whatever the host logs is worth having in a failing run; a stack trace
    // from it would otherwise vanish into a closed pipe.
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[host ${this.port}] ${chunk.toString()}`)
    })

    // A run that dies before `dispose` would otherwise leave the port held,
    // and the next run fails on a mystery instead of starting.
    process.once('exit', () => child.kill())

    // A host that dies mid-command would otherwise leave the suite waiting on
    // a reply that is never coming, until the hook times out.
    child.on('exit', (code) => {
      for (const [, waiting] of this.pending) {
        waiting.reject(new Error(`The host process exited (code ${code})`))
      }
      this.pending.clear()
    })

    return this.send<{ libraryUrl: AutomergeUrl }>({
      type: 'start',
      webClientPath: options.webClientPath,
      signs: options.signs ?? false,
    })
  }

  /**
   * Puts a recording on the host: bytes in its blob store, a document pointing
   * at them, and that document on the root document. To a guest this is a
   * tape it never recorded.
   */
  seed(options: SeedOptions): Promise<SeededRecording> {
    return this.send<SeededRecording>({
      type: 'seed',
      name: options.name,
      seconds: options.seconds,
      frequency: options.frequency ?? 440,
      withBytes: options.withBytes ?? true,
      withClaim: options.withClaim ?? false,
    })
  }

  objects(): Promise<HostObject[]> {
    return this.send<HostObject[]>({ type: 'objects' })
  }

  /** The root document's recordings, by name and url, as the host has them. */
  recordings(): Promise<{ url: string; name: string }[]> {
    return this.send<{ url: string; name: string }[]>({ type: 'recordings' })
  }

  /** Takes the host off the network, leaving its storage in place. */
  stop(): Promise<void> {
    return this.send<void>({ type: 'stop' })
  }

  /** Brings a stopped host back up on the same port, with the same storage. */
  restart(): Promise<void> {
    return this.send<void>({ type: 'restart' })
  }

  async dispose(): Promise<void> {
    if (!this.child) {
      return
    }
    const dying = this.child
    try {
      await this.send<null>({ type: 'dispose' })
    } catch {
      // It was on its way out anyway; the kill below finishes the job.
    } finally {
      dying.kill()
      this.child = undefined
      this.pending.clear()
    }
  }
}

/** The host on `HOST_PORT`, which the guest's dev server proxies to. */
const defaultHost = new Host()

export function startHost(
  options: HostOptions = {},
): Promise<{ libraryUrl: AutomergeUrl }> {
  return defaultHost.start(options)
}

export function seedRecording(options: SeedOptions): Promise<SeededRecording> {
  return defaultHost.seed(options)
}

export function hostObjects(): Promise<HostObject[]> {
  return defaultHost.objects()
}

export function hostRecordings(): Promise<{ url: string; name: string }[]> {
  return defaultHost.recordings()
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

export function stopHost(): Promise<void> {
  return defaultHost.stop()
}

export function restartHost(): Promise<void> {
  return defaultHost.restart()
}

export function disposeHost(): Promise<void> {
  return defaultHost.dispose()
}
