import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { startSyncServer, stopSyncServer } from './syncServer'

let storagePath: string | undefined

afterEach(async () => {
  await stopSyncServer()
  if (storagePath) {
    await rm(storagePath, { recursive: true, force: true })
    storagePath = undefined
  }
})

async function startForTest() {
  storagePath = await mkdtemp(path.join(tmpdir(), 'tapes-sync-'))
  return startSyncServer({
    storagePath,
    host: '127.0.0.1',
    // 0 lets the OS pick a free port so the suite never collides with a
    // running desktop app on the default port.
    port: 0,
    peerId: 'test-host',
  })
}

function connect(url: string) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.on('open', () => {
      socket.close()
      resolve()
    })
    socket.on('error', reject)
  })
}

describe('startSyncServer', () => {
  // The web client derives its sync URL as `<origin>/sync` in every mode
  // (see apps/web-client/src/main.tsx): in development Vite proxies that path
  // here, and in production this server receives it verbatim. That only works
  // because the WebSocket server is attached to the whole http server rather
  // than a route, so it must keep accepting the upgrade on a non-root path.
  it('accepts a sync socket on the /sync path', async () => {
    const info = await startForTest()

    await expect(connect(`${info.url}/sync`)).resolves.toBeUndefined()
  })

  it('accepts a sync socket on the root path', async () => {
    const info = await startForTest()

    await expect(connect(info.url)).resolves.toBeUndefined()
  })
})
