import http from 'http'
import https from 'https'
import os from 'os'
import path from 'path'
import { readFile } from 'fs/promises'
import { WebSocketServer } from 'ws'
// The slim entrypoints + base64 WASM keep the Automerge core inside the
// bundled JS, so nothing has to resolve .wasm files from inside the asar.
import { Repo, type PeerId } from '@automerge/automerge-repo/slim'
import {
  initializeBase64Wasm,
  isWasmInitialized,
} from '@automerge/automerge/slim'
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64'
import { WebSocketServerAdapter } from '@automerge/automerge-repo-network-websocket'
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs'

export const DEFAULT_SYNC_SERVER_PORT = 9001

export type SyncServerInfo = {
  running: boolean
  url: string
  lanUrl?: string
  /** URL of the hosted web-client bundle, when one is being served. */
  webAppUrl?: string
  /** LAN-reachable URL of the hosted web-client bundle. */
  lanWebAppUrl?: string
  port: number
  host: string
}

export type SyncServerOptions = {
  storagePath: string
  host: '127.0.0.1' | '0.0.0.0'
  port?: number
  peerId: string
  /**
   * Directory of the built web-client bundle to serve statically over the
   * same origin as the sync socket. When omitted, the HTTP surface is just a
   * health-check and only the WebSocket sync endpoint is exposed.
   */
  webClientPath?: string
  /**
   * Self-signed key+cert. When provided the server runs over HTTPS (and the
   * sync socket over `wss://`) on the same port, so a guest gets a secure
   * context — required for both recording and OPFS-backed playback — and the
   * `wss://` handshake reuses the accepted cert exception (same origin).
   */
  tls?: { key: string; cert: string }
}

type RunningSyncServer = {
  info: SyncServerInfo
  repo: Repo
  wss: WebSocketServer
  server: http.Server
}

let current: RunningSyncServer | null = null

export function getSyncServerInfo(): SyncServerInfo {
  return (
    current?.info ?? {
      running: false,
      url: '',
      port: 0,
      host: '',
    }
  )
}

export function getLocalNetworkIp(): string | undefined {
  const interfaces = os.networkInterfaces()
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address
      }
    }
  }
  return undefined
}

const STATIC_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Builds the HTTP request handler. When `webClientPath` is set it serves the
 * built web-client bundle (with an SPA fallback to index.html so deep links
 * like `/?am=<url>` work); otherwise it responds with a plain health check.
 */
function createRequestHandler(webClientPath?: string) {
  return async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    if (!webClientPath) {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('tapes-sync-server')
      return
    }

    const root = path.resolve(webClientPath)
    const indexPath = path.join(root, 'index.html')

    const requestUrl = new URL(request.url ?? '/', 'http://localhost')
    const requestedPath = path.normalize(
      decodeURIComponent(requestUrl.pathname),
    )
    const candidate = path.join(root, requestedPath)

    // Guard against path traversal outside the served directory.
    const filePath =
      candidate === root || candidate.startsWith(root + path.sep)
        ? candidate
        : indexPath

    const serve = async (target: string) => {
      const data = await readFile(target)
      const ext = path.extname(target).toLowerCase()
      response.writeHead(200, {
        'Content-Type': STATIC_MIME_TYPES[ext] ?? 'application/octet-stream',
      })
      response.end(data)
    }

    try {
      await serve(filePath)
    } catch {
      // Missing file, directory, or SPA route -> fall back to index.html.
      try {
        await serve(indexPath)
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain' })
        response.end('Not found')
      }
    }
  }
}

function listen(server: http.Server, host: string, port: number) {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Sync server address unavailable'))
        return
      }
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export async function startSyncServer(
  options: SyncServerOptions,
): Promise<SyncServerInfo> {
  if (current) {
    return current.info
  }

  if (!isWasmInitialized()) {
    await initializeBase64Wasm(automergeWasmBase64)
  }

  const { storagePath, host, peerId, webClientPath, tls } = options
  const requestedPort = options.port ?? DEFAULT_SYNC_SERVER_PORT

  const handler = createRequestHandler(webClientPath)
  const server = tls
    ? https.createServer({ key: tls.key, cert: tls.cert }, handler)
    : http.createServer(handler)

  let port: number
  try {
    port = await listen(server, host, requestedPort)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
      throw error
    }
    // The renderer always receives the URL over IPC, so a fallback to an
    // OS-assigned port is safe.
    port = await listen(server, host, 0)
  }

  const wss = new WebSocketServer({ server })

  // The adapter types its server via isomorphic-ws, which is the same ws
  // class at runtime but a structurally incompatible type.
  const adapterServer = wss as unknown as ConstructorParameters<
    typeof WebSocketServerAdapter
  >[0]

  const repo = new Repo({
    network: [new WebSocketServerAdapter(adapterServer)],
    storage: new NodeFSStorageAdapter(storagePath),
    peerId: peerId as PeerId,
    sharePolicy: async () => false,
  })

  const lanIp = host === '0.0.0.0' ? getLocalNetworkIp() : undefined
  const wsScheme = tls ? 'wss' : 'ws'
  const httpScheme = tls ? 'https' : 'http'

  current = {
    info: {
      running: true,
      url: `${wsScheme}://127.0.0.1:${port}`,
      lanUrl: lanIp ? `${wsScheme}://${lanIp}:${port}` : undefined,
      webAppUrl: webClientPath ? `${httpScheme}://127.0.0.1:${port}` : undefined,
      lanWebAppUrl:
        webClientPath && lanIp ? `${httpScheme}://${lanIp}:${port}` : undefined,
      port,
      host,
    },
    repo,
    wss,
    server,
  }

  console.log(`Sync server listening on ${wsScheme}://${host}:${port}`)

  return current.info
}

export async function stopSyncServer(): Promise<void> {
  if (!current) {
    return
  }
  const { repo, wss, server } = current
  current = null

  await repo.flush()
  for (const client of wss.clients) {
    client.terminate()
  }
  await new Promise<void>((resolve) => wss.close(() => resolve()))
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
