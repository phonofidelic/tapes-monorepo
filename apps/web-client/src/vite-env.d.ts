/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_SERVER_URL?: string
  // Set by electron-client's `stage-web-client` script: marks a bundle the
  // Electron host serves itself, as opposed to a standalone static deploy.
  // That script also blanks VITE_SYNC_SERVER_URL, because a developer's
  // `.env.local` would otherwise be inlined into the staged bundle and outrank
  // the host's own origin.
  readonly VITE_SERVED_BY_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
