// THROWAWAY PROTOTYPE (TAP-219). Not production code.
//
// Bundles the guest script and the server with esbuild, then starts the
// server. Run from the repo root after `yarn`:
//   node prototypes/host-vouch/run.mjs [--port 9443] [--operator-port 9400]

import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, '.out')

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : Number(process.argv[index + 1])
}

// Read the provenance package from source, so it needs no build first.
const alias = {
  '@tapes-monorepo/provenance': path.resolve(
    here,
    '../../packages/provenance/lib/index.ts',
  ),
}

const guest = await build({
  entryPoints: [path.join(here, 'guest/guest.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  alias,
})

await build({
  entryPoints: [path.join(here, 'server/server.ts')],
  outfile: path.join(outDir, 'server.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  alias,
})

const { startPrototype } = await import(
  pathToFileURL(path.join(outDir, 'server.mjs')).href
)
await startPrototype({
  dataDir: path.join(here, '.data'),
  guestScript: guest.outputFiles[0].text,
  port: arg('--port', 9443),
  operatorPort: arg('--operator-port', 9400),
})
