import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSyncServer, stopSyncServer } from './syncServer'

let storagePath: string | undefined

afterEach(async () => {
  await stopSyncServer()
  if (storagePath) {
    await rm(storagePath, { recursive: true, force: true })
    storagePath = undefined
  }
})

async function startForTest(pairingToken?: string) {
  storagePath = await mkdtemp(path.join(tmpdir(), 'tapes-sync-'))
  return startSyncServer({
    storagePath,
    host: '127.0.0.1',
    // 0 lets the OS pick a free port so the suite never collides with a
    // running desktop app on the default port.
    port: 0,
    peerId: 'test-host',
    pairingToken,
  })
}

function connect(url: string, headers?: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, { headers })
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

  // The token is the only thing standing between a LAN peer and the whole
  // library, so an upgrade that does not carry it must never reach the repo.
  describe('with a pairing token', () => {
    const token = 'pairing-secret'

    it('rejects an upgrade with no token', async () => {
      const info = await startForTest(token)

      await expect(connect(`${info.url}/sync`)).rejects.toThrow('401')
    })

    it('rejects an upgrade with the wrong token', async () => {
      const info = await startForTest(token)

      await expect(connect(`${info.url}/sync?t=nope`)).rejects.toThrow('401')
    })

    // A browser cannot set headers on a WebSocket, so `?t=` is the form every
    // paired guest actually uses.
    it('accepts an upgrade carrying the token as a query parameter', async () => {
      const info = await startForTest(token)

      await expect(
        connect(`${info.url}/sync?t=${token}`),
      ).resolves.toBeUndefined()
    })

    it('accepts an upgrade carrying the token as a bearer header', async () => {
      const info = await startForTest(token)

      await expect(
        connect(`${info.url}/sync`, { authorization: `Bearer ${token}` }),
      ).resolves.toBeUndefined()
    })
  })
})

// The name is read on the upgrade request, so the host has one for every
// connection it accepts.
describe('guest device labels', () => {
  it('names a guest by the label on its upgrade request', async () => {
    const info = await startForTest()
    const logged = vi.spyOn(console, 'info').mockImplementation(() => {})

    await connect(`${info.url}/sync?d=Studio%20iPad`)

    expect(logged).toHaveBeenCalledWith('Sync guest connected: Studio iPad')
    logged.mockRestore()
  })

  it('names a guest that sent nothing usable', async () => {
    const info = await startForTest()
    const logged = vi.spyOn(console, 'info').mockImplementation(() => {})

    await connect(`${info.url}/sync?d=%20`)

    expect(logged).toHaveBeenCalledWith('Sync guest connected: Unnamed device')
    logged.mockRestore()
  })

  // A guest chooses this string, and it lands in a log line.
  it('strips control characters out of a label before logging it', async () => {
    const info = await startForTest()
    const logged = vi.spyOn(console, 'info').mockImplementation(() => {})
    const forged = encodeURIComponent(
      `iPad${String.fromCharCode(0x0a)}Sync guest connected: host`,
    )

    await connect(`${info.url}/sync?d=${forged}`)

    expect(logged).toHaveBeenCalledWith(
      'Sync guest connected: iPad Sync guest connected: host',
    )
    logged.mockRestore()
  })
})
