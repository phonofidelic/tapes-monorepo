import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { SYNC_PORT } from './ports'

/**
 * The real desktop app, launched from its packaged bundle and driven like any
 * other Playwright target.
 *
 * Packaged rather than a bare `electron .`: it is the build users run, and it
 * is the only one where `process.resourcesPath` — which is where the app looks
 * for its `sox` binary and its staged web-client — means anything.
 *
 * Everything the app writes goes to a fresh `--user-data-dir`, so a run never
 * reads or rewrites the developer's own library, and its blob store and
 * `sync-server.json` are ours to inspect.
 */

// `__dirname` rather than `import.meta.url`: this workspace is not
// `type: module`, so Playwright loads these files as CommonJS.
export const APP_ROOT = path.resolve(__dirname, '..')

/** The binaries `yarn get-bin` fetches, which packaging stages as resources. */
const REQUIRED_BINARIES = [
  'bin/sox-14.4.2-macOS',
  'bin/SwitchAudioSource-1.2.2-macOS',
]

export type LaunchedApp = {
  app: ElectronApplication
  /** The renderer's window, already past the "Loading..." bootstrap. */
  page: Page
  /** Where `--user-data-dir` put the app's state, blob store included. */
  userDataPath: string
  /** The directory the app is configured to record into. */
  storageLocation: string
  /** The token this install minted, as its guests are handed it by QR. */
  pairingToken: string
  /** The library document a guest pairs with. */
  libraryUrl: AutomergeUrl
  close: () => Promise<void>
}

/**
 * `Tapes.app`'s executable, as `electron-forge package` lays it out.
 *
 * `out-e2e`, not `out`: the build this suite drives has the node inspector fuse
 * turned back on (see forge.config.ts), so it must never be confused with the
 * `yarn package` output a developer might go on to ship.
 */
function packagedExecutable(): string {
  return path.join(
    APP_ROOT,
    'out-e2e',
    `Tapes-${process.platform}-${process.arch}`,
    'Tapes.app',
    'Contents',
    'MacOS',
    'Tapes',
  )
}

/** The nearest `node_modules/.bin` above the app, which a worktree needs. */
function resolveBin(name: string): string {
  let directory = APP_ROOT
  for (;;) {
    const candidate = path.join(directory, 'node_modules', '.bin', name)
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(directory)
    if (parent === directory) {
      throw new Error(`Could not find \`${name}\` in any node_modules/.bin`)
    }
    directory = parent
  }
}

/**
 * Runs a `node_modules/.bin` script under the current node.
 *
 * Through `node` rather than executing the shim directly: the shims are
 * symlinks into a package's `dist`, and whether the file behind one carries the
 * executable bit depends on how the install was linked — in a git worktree that
 * resolves up to a parent's `node_modules`, it does not.
 */
function runBin(name: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [resolveBin(name), ...args], {
      cwd: APP_ROOT,
      // Inherited: packaging takes minutes and says why when it fails, and a
      // captured stream would only surface after the fact.
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`)),
    )
  })
}

/**
 * Packages the app if it has not been packaged already.
 *
 * Deliberately not a rebuild-if-stale check: packaging is minutes of signing
 * and asar work, and a suite that silently repackaged on every source change
 * would make a single test run unpredictably long. Delete `out-e2e/` to
 * force one.
 */
export async function ensurePackagedApp(): Promise<string> {
  const executable = packagedExecutable()
  if (existsSync(executable)) {
    return executable
  }

  const missing = REQUIRED_BINARIES.filter(
    (binary) => !existsSync(path.join(APP_ROOT, binary)),
  )
  if (missing.length > 0) {
    throw new Error(
      `Cannot package the app: ${missing.join(', ')} ${
        missing.length > 1 ? 'are' : 'is'
      } missing. Run \`yarn workspace electron-client get-bin\` first — it ` +
        'downloads sox and builds switchaudio-osx, and packaging stages both ' +
        'as resources.',
    )
  }

  // `electron-forge package` directly, not the workspace's `package` script:
  // that one runs under `dotenvx --env-file=.env`, and `.env` is git-ignored
  // and holds only publishing credentials this build has no use for. It also
  // skips `stage-web-client`, because the guest in these tests loads the
  // web-client from its own dev server rather than from this host.
  // `TAPES_E2E` is what makes forge emit a build this suite can drive, into
  // `out-e2e` rather than `out`.
  await runBin('electron-forge', ['package'], { TAPES_E2E: '1' })

  if (!existsSync(executable)) {
    throw new Error(
      `Packaging finished but produced no app at ${executable}. ` +
        "Has forge.config.ts's product name changed?",
    )
  }
  return executable
}

/**
 * Waits for the embedded server to answer on the port we pinned.
 *
 * `startSyncServer` falls back to an OS-assigned port when the one it asked for
 * is taken, which would leave the app perfectly healthy and the guest's proxies
 * pointed at nothing. An unauthorized request is enough to prove who is there:
 * it needs no token and cannot be answered by anything but our server.
 */
async function waitForSyncServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${SYNC_PORT}/blobs/probe`)
      // 401 unauthorized, 404 unknown blob — either is our server talking.
      if (response.status === 401 || response.status === 404) {
        return
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Nothing answered on port ${SYNC_PORT}. The app's embedded server ` +
          'either never started or fell back to another port because ' +
          'something else holds this one — a stale e2e run, or the ' +
          "developer's own desktop app.",
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/** Everything the app's blob store is holding, by hash. */
export async function blobObjects(
  userDataPath: string,
): Promise<{ hash: string; size: number }[]> {
  const root = path.join(userDataPath, 'blobs', 'objects')
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
 * Waits until the embedded server has written a document to its own storage.
 *
 * The renderer holds its repo in IndexedDB and syncs to the server over a
 * socket, so a document existing in the window is no promise that the device of
 * record has it. The server's `NodeFSStorageAdapter` writing it is the first
 * moment anything else asking for that document is guaranteed an answer.
 *
 * The adapter shards by the first two characters of the document id, so this
 * looks for that exact directory rather than counting what is in the store —
 * two documents whose ids share a prefix share a directory.
 */
async function waitForStoredDoc(
  userDataPath: string,
  url: AutomergeUrl,
  timeoutMs = 30_000,
): Promise<void> {
  const id = url.replace(/^automerge:/, '')
  const directory = path.join(
    userDataPath,
    'sync-storage',
    id.slice(0, 2),
    id.slice(2),
  )
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await stat(directory)
      return
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`The app never stored the document at ${url}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

/** The token this install minted, which its guests are paired with. */
async function readPairingToken(userDataPath: string): Promise<string> {
  const configPath = path.join(userDataPath, 'sync-server.json')
  const deadline = Date.now() + 15_000
  for (;;) {
    try {
      const { pairingToken } = JSON.parse(
        await readFile(configPath, 'utf-8'),
      ) as { pairingToken?: string }
      if (pairingToken) {
        return pairingToken
      }
    } catch {
      // The app writes this on its first config read, during startup.
    }
    if (Date.now() > deadline) {
      throw new Error(`The app never wrote a pairing token to ${configPath}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/**
 * Launches the app, points it at a recording directory, and waits until it has
 * a library.
 *
 * The storage location is seeded into the renderer's own settings rather than
 * clicked through the directory dialog: that dialog is native, and Playwright
 * cannot drive it. Everything downstream — which is all of what this suite is
 * about — runs exactly as it does for a user.
 */
export async function launchTapes(): Promise<LaunchedApp> {
  const executablePath = await ensurePackagedApp()

  const root = await mkdtemp(path.join(os.tmpdir(), 'tapes-e2e-electron-'))
  const userDataPath = path.join(root, 'user-data')
  const storageLocation = path.join(root, 'recordings')
  await mkdir(userDataPath, { recursive: true })
  await mkdir(storageLocation, { recursive: true })

  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataPath}`],
    env: {
      ...process.env,
      // Pins the embedded server to the port the guest's dev server proxies to.
      TAPES_SYNC_SERVER_PORT: String(SYNC_PORT),
      // Keeps the auto-updater from replacing the build under test.
      TAPES_E2E: '1',
    },
  })

  // The main process's own output, which is where the sync server, the blob
  // store and every IPC channel log.
  app.process().stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[main] ${chunk.toString()}`)
  })

  const page = await app.firstWindow()
  await waitForSyncServer()
  const pairingToken = await readPairingToken(userDataPath)

  // The bootstrap resolves the embedded server over IPC and only then builds
  // the repo, so the app renders "Loading..." until it has a library.
  await page
    .getByRole('button', { name: 'Recorder' })
    .waitFor({ state: 'visible', timeout: 30_000 })

  const libraryUrl = (await page.evaluate(() =>
    localStorage.getItem('automergeUrl'),
  )) as AutomergeUrl | null
  if (!libraryUrl) {
    throw new Error('The app never stored a library url')
  }

  // Before the reload below, not after it. A first launch *creates* the
  // library, and the renderer holds it in IndexedDB while it makes its way to
  // the embedded server over the socket. Reload inside that window and the
  // bootstrap takes the `repo.find` path against a server that has never heard
  // of the document, which reports it unavailable and replaces the whole app
  // with "Your library could not be loaded from this device."
  await waitForStoredDoc(userDataPath, libraryUrl)

  await page.evaluate((location) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}')
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...settings,
        storageLocation: location,
        // Reveals the record button. `AudioInputSelector` writes this when the
        // user picks a device, and its only other job — telling the system
        // which input to make default — is what `sox --default-device` then
        // captures from, so a device *id* changes nothing about the capture.
        audioInputDeviceId: 'e2e-default-input',
        audioFormat: 'wav',
        audioChannelCount: '1',
      }),
    )
  }, storageLocation)
  await page.reload()
  await page
    .getByRole('button', { name: 'Recorder' })
    .waitFor({ state: 'visible', timeout: 30_000 })

  return {
    app,
    page,
    userDataPath,
    storageLocation,
    pairingToken,
    libraryUrl,
    close: async () => {
      await app.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
