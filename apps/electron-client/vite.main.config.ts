import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// https://vitejs.dev/config
export default defineConfig({
  // The Automerge packages used by the embedded sync server are ESM with a
  // WASM core; resolve their Node entrypoints and inline the WASM so the
  // bundle works from inside the packaged app's asar.
  resolve: {
    conditions: ['node'],
  },
  plugins: [wasm(), topLevelAwait()],
})
