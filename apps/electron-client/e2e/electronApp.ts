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
 * Packaged, not `electron .`, because only the packaged build resolves the
 * bundled sox binary and staged web-client through the resources path.
 * Everything the app writes goes to a fresh user-data directory, so a run
 * never touches the developer's own library and the suite can inspect it.
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
 * The app's executable, as packaging lays it out. It lives in `out-e2e`, not
 * the normal output directory. This build has the node inspector fuse turned
 * back on in the forge config, so it must never be shipped.
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
 * Through node rather than the shim directly. The shims are symlinks into a
 * package's dist, and in a git worktree that resolves to a parent's install
 * the file behind one lacks the executable bit.
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
 * Not a rebuild-if-stale check. Packaging is minutes of signing and asar work,
 * and repackaging on every source change would make a run unpredictably long.
 * Delete `out-e2e/` to force one.
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

  // Runs forge directly rather than the workspace's `package` script. That
  // script loads a git-ignored env file of publishing credentials this build
  // does not need, and stages the web-client, which the guest here loads from
  // its own dev server instead. `TAPES_E2E` makes forge emit into `out-e2e`.
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
 * Waits for the embedded server to answer on the pinned port.
 *
 * The server falls back to an OS-assigned port when its port is taken. The app
 * would then be healthy and the guest's proxies pointed at nothing. An
 * unauthorized request proves who is listening and needs no token.
 */
async function waitForSyncServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${SYNC_PORT}/blobs/probe`)
      // 401 unauthorized or 404 unknown blob. Either is our server talking.
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
 * The renderer keeps its repo in IndexedDB and syncs to the server over a
 * socket. A document in the window is no promise the server has it. The
 * server's storage adapter shards by the first two characters of the id, so
 * this waits for that exact directory rather than counting entries.
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
 * The storage location is seeded into the renderer's settings rather than
 * chosen through the directory dialog, which is native and beyond Playwright.
 * Everything downstream runs exactly as it does for a user.
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

  // Wait before the reload below. A first launch creates the library in
  // IndexedDB and syncs it to the embedded server over the socket. A reload
  // inside that window makes the bootstrap look the document up on a server
  // that has never heard of it, and the app shows "Your library could not be
  // loaded from this device."
  await waitForStoredDoc(userDataPath, libraryUrl)

  await page.evaluate((location) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}')
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...settings,
        storageLocation: location,
        // Reveals the record button. The electron selector's only other job is
        // to make the chosen device the system default, which is what sox then
        // captures from. The id itself changes nothing about the capture.
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
