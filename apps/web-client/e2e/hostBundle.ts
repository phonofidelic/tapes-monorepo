import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The build the streaming suite runs against: the web client as the desktop
 * host serves it to a LAN guest.
 *
 * Two build-time flags make that bundle different from the standalone deploy.
 * `VITE_SERVED_BY_HOST` swaps the precaching service worker for the blob-auth
 * one and is what `src/main.tsx` registers on. A blank `VITE_SYNC_SERVER_URL`
 * leaves the app resolving sync to its own origin, which is where the host
 * listens. `apps/electron-client`'s `stage-web-client` script sets the same
 * pair.
 */

const webClientRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

/**
 * Where that build lands. Its own directory, not `dist/`: the pwa project
 * previews a standalone build out of `dist/`, and the two would overwrite each
 * other on every run.
 */
export const HOST_BUNDLE_DIR = path.join(webClientRoot, 'dist-host')

/**
 * Builds it. `vite build` directly rather than the workspace `build` script,
 * which also runs `tsc` and the precache check. Types are a separate CI gate,
 * and the precache check exits early for this bundle anyway.
 */
export function buildHostBundle(): Promise<void> {
  return new Promise((resolve, reject) => {
    const build = spawn(
      'yarn',
      [
        'vite',
        'build',
        '--outDir',
        HOST_BUNDLE_DIR,
        // Without this Vite refuses to clear an out dir outside `root`.
        '--emptyOutDir',
      ],
      {
        cwd: webClientRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          VITE_SERVED_BY_HOST: 'true',
          VITE_SYNC_SERVER_URL: '',
        },
      },
    )
    build.on('error', reject)
    build.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Building the host-served bundle failed (code ${code})`))
    })
  })
}
