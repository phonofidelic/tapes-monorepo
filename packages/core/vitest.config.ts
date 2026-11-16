import fs from 'fs'
import os from 'os'
import path from 'path'
import { defineConfig, type ViteUserConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The vitest config for this package, kept separate from the build config in
// vite.config.ts. Two things to know before editing. Tests run in jsdom, so a
// guard below stops the run on a Node version that breaks it. The aliases must
// stay in step with vite.config.ts, or imports resolve differently under test.

function pinnedNodeVersion(): string | undefined {
  try {
    const nvmrc = fs.readFileSync(
      path.resolve(__dirname, '../../.nvmrc'),
      'utf8',
    )
    return nvmrc.trim().replace(/^v/, '') || undefined
  } catch {
    return undefined
  }
}

// A PATH prefix is only worth printing if the binary is really there. A prefix
// naming a missing directory is ignored by the shell. The advice would then
// change nothing and the reader would hit this same error again. Only the nvm
// layout is checked, since that is the one the repo documents.
function howToUsePinnedNode(pinned: string | undefined): string {
  if (!pinned) return 'Run the tests with the Node version named in .nvmrc.'

  const relativeBin = `.nvm/versions/node/v${pinned}/bin`
  const installed = fs.existsSync(path.join(os.homedir(), relativeBin, 'node'))

  if (!installed) {
    return `This repo pins Node ${pinned} in .nvmrc, which is not installed here. Install it and put it first on PATH.`
  }
  // Printed unexpanded so it can be pasted into a shell.
  return `This repo pins Node ${pinned} in .nvmrc. Run the tests with it:\n\n  PATH="$HOME/${relativeBin}:$PATH" yarn test`
}

// Node 25 and later define their own `localStorage` global. Vitest's jsdom
// environment uses one object for both the window and the global scope.
// Node's global wins, so jsdom never installs its own Storage. Reads come
// back undefined. Every test that clears storage in a setup hook then fails
// on undefined, which looks like a regression in the code under test. Node
// warns about the missing storage only once, and quietly. Failing here puts
// the cause and the fix in one message.
// The check is behavioral rather than a version test. The global arrived in
// Node 25 and may move again.
if ('localStorage' in globalThis) {
  const lines = [
    `Node ${process.version} cannot run the core tests.`,
    '',
    'It defines its own `localStorage`, which shadows the one jsdom installs.',
    'Every test that touches storage would fail on a property of undefined.',
    '',
    howToUsePinnedNode(pinnedNodeVersion()),
    '',
    `In use now: ${process.execPath}`,
    '`nvm use` has no effect when another node directory comes earlier on PATH.',
  ]
  throw new Error(lines.join('\n'))
}

export default defineConfig({
  // vitest depends on vite 7 while this workspace uses vite 8, so the plugin's
  // type does not match what vitest expects. The cast satisfies the type
  // checker only. The plugin itself works.
  plugins: [react()] as unknown as ViteUserConfig['plugins'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
      '@tapes-monorepo/ui': path.resolve(__dirname, '../ui/dist/ui.js'),
      '@tapes-monorepo/ui-styles': path.resolve(__dirname, '../ui/dist/ui.css'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
})
