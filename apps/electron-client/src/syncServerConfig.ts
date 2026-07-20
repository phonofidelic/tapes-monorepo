import crypto from 'crypto'
import path from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

export type SyncServerConfig = {
  peerId: string
  lanEnabled: boolean
}

const configFilePath = () =>
  path.join(app.getPath('userData'), 'sync-server.json')

export const syncStoragePath = () =>
  path.join(app.getPath('userData'), 'sync-storage')

/**
 * Resolves the directory of the bundled web-client, staged as an
 * `extraResource` in production (see forge.config.ts) and read from the
 * sibling package's `dist` in development. Returns `undefined` when no built
 * bundle is present, so hosting is only advertised when it can actually work.
 */
export const webClientPath = (): string | undefined => {
  const candidate =
    process.env.NODE_ENV !== 'development'
      ? path.resolve(process.resourcesPath, 'web-client')
      : path.resolve(app.getAppPath(), '..', 'web-client', 'dist')

  return existsSync(path.join(candidate, 'index.html')) ? candidate : undefined
}

export function readSyncServerConfig(): SyncServerConfig {
  try {
    const stored = JSON.parse(
      readFileSync(configFilePath(), 'utf-8'),
    ) as Partial<SyncServerConfig>
    if (typeof stored.peerId === 'string') {
      return { peerId: stored.peerId, lanEnabled: stored.lanEnabled === true }
    }
  } catch {
    // Missing or corrupt config falls through to defaults.
  }

  const config: SyncServerConfig = {
    peerId: `tapes-embedded-${crypto.randomUUID()}`,
    lanEnabled: false,
  }
  writeSyncServerConfig(config)
  return config
}

export function writeSyncServerConfig(config: SyncServerConfig) {
  writeFileSync(configFilePath(), JSON.stringify(config, null, 2))
}
