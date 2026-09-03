import { createInterface } from 'node:readline'
import { Repo, type AutomergeUrl } from '@automerge/automerge-repo'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import type { RecordingData, RecordingRepoState } from '@tapes-monorepo/core'

/**
 * A third device on the app-under-test's library, as its own process.
 *
 * The suite's assertions are about what the *document* says — that a recording
 * the renderer made gained a blob descriptor, and that its hash is the one the
 * store holds. Reading that from either UI would only tell us what a view
 * decided to render; reading it from a real Automerge peer of the host is the
 * document itself.
 *
 * Its own process, not an import into the Playwright worker, for the reason
 * `apps/web-client/e2e/hostProcess.ts` gives: Playwright's CJS transform
 * reaches Automerge's broken `require` entry for the wasm blob, and these
 * modules have to load as ESM. `peer.ts` drives this over stdio; the protocol
 * is one JSON object per line, in both directions.
 */

type Command =
  | { id: number; type: 'connect'; url: string }
  | { id: number; type: 'recordings'; libraryUrl: AutomergeUrl }
  | {
      id: number
      type: 'awaitRecording'
      libraryUrl: AutomergeUrl
      name: string
      /** Wait for its blob descriptor too, not merely for the document. */
      withDescriptor: boolean
      timeoutMs: number
    }
  | { id: number; type: 'dispose' }

let disposing = false
let repo: Repo | undefined
let adapter: BrowserWebSocketClientAdapter | undefined

async function connect(url: string) {
  adapter = new BrowserWebSocketClientAdapter(url)
  repo = new Repo({ network: [adapter] })
  await repo.networkSubsystem.whenReady()
  return null
}

/** Every recording on the library, as the document holds it. */
async function recordings(libraryUrl: AutomergeUrl) {
  const library = await repo!.find<RecordingRepoState>(libraryUrl)
  const urls = library.doc().recordings ?? []
  return Promise.all(
    urls.map(async (url) => {
      const handle = await repo!.find<RecordingData>(url)
      const doc = handle.doc()
      return {
        url,
        name: doc.name,
        filepath: doc.filepath,
        duration: doc.duration,
        blob: doc.blob,
      }
    }),
  )
}

/**
 * Waits for a named recording to reach this peer, optionally with its
 * descriptor attached.
 *
 * Polled rather than driven off `change` events: the recording arrives as a new
 * url pushed onto the library and then as a document of its own, and the
 * descriptor lands as a *second* change to that document some time after — a
 * subscription would have to be rebuilt at each of those steps anyway.
 */
async function awaitRecording(
  command: Extract<Command, { type: 'awaitRecording' }>,
) {
  const deadline = Date.now() + command.timeoutMs
  for (;;) {
    const found = (await recordings(command.libraryUrl)).find(
      (recording) => recording.name === command.name,
    )
    if (found && (!command.withDescriptor || found.blob)) {
      return found
    }
    if (Date.now() > deadline) {
      throw new Error(
        found
          ? `"${command.name}" never gained a blob descriptor`
          : `"${command.name}" never reached the host`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function run(command: Command): Promise<unknown> {
  switch (command.type) {
    case 'connect':
      return connect(command.url)
    case 'recordings':
      return recordings(command.libraryUrl)
    case 'awaitRecording':
      return awaitRecording(command)
    case 'dispose':
      disposing = true
      adapter?.disconnect()
      adapter = undefined
      repo = undefined
      return null
  }
}

/**
 * Automerge saves sync state on a throttle, so a write can still be pending
 * when the socket goes; being a background timer, its rejection would take the
 * process down before it could answer the dispose. Nothing is left to salvage
 * at that point, so during teardown these are swallowed.
 */
process.on('unhandledRejection', (reason) => {
  if (disposing) {
    return
  }
  throw reason
})

// stdout is the protocol: anything else reaching this stream arrives at
// `peer.ts` as a line that is not JSON.
console.log = (...args: unknown[]) => {
  process.stderr.write(`${args.join(' ')}\n`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
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
