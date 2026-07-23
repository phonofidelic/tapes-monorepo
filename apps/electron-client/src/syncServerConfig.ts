import crypto from 'crypto'
import path from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { app } from 'electron'

export type SyncServerConfig = {
  peerId: string
  lanEnabled: boolean
}

const configFilePath = () =>
  path.join(app.getPath('userData'), 'sync-server.json')

export const syncStoragePath = () =>
  path.join(app.getPath('userData'), 'sync-storage')

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
