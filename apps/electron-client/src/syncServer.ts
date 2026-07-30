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
import { createBlobStore, type BlobStore } from './blobStore'
import { createBlobRequestHandler } from './blobHttp'

export const DEFAULT_SYNC_SERVER_PORT = 9001

/** Uploads abandoned mid-stream are cleared once they are a day old. */
const TMP_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type SyncServerInfo = {
  running: boolean
  url: string
  lanUrl?: string
  /** URL of the hosted web-client bundle, when one is being served. */
  webAppUrl?: string
  /** LAN-reachable URL of the hosted web-client bundle. */
  lanWebAppUrl?: string
  /** Origin serving `/blobs`, when a blob store is configured. */
  blobBaseUrl?: string
  /** LAN-reachable origin serving `/blobs`. */
  lanBlobBaseUrl?: string
  /**
   * Bearer token for `/blobs`. Handed to guests through the QR pairing URL;
   * never log this object wholesale.
   */
  blobToken?: string
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
  /**
   * In development, the LAN URL of the web-client's Vite dev server. When set it
   * is advertised to guests (as `webAppUrl`/`lanWebAppUrl`) instead of a URL for
   * the statically served bundle, so guests load the HMR-enabled dev server. The
   * sync socket still runs here; the dev server proxies `/sync` back to it.
   */
  webAppDevUrl?: string
  /**
   * Root of the content-addressed audio store. When omitted the `/blobs`
   * routes are still matched but answer 503, so the server keeps working (and
   * keeps its tests passing) without one.
   */
  blobStorePath?: string
  /** Bearer token guarding `/blobs`. */
  blobToken?: string
}

type RunningSyncServer = {
  info: SyncServerInfo
  repo: Repo
  wss: WebSocketServer
  server: http.Server
  blobStore?: BlobStore
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

/**
 * The running host's blob store, for the IPC channels that ingest a locally
 * recorded file without going over HTTP.
 */
export function getBlobStore(): BlobStore | undefined {
  return current?.blobStore
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
function createRequestHandler(
  webClientPath?: string,
  handleBlobRequest?: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => Promise<boolean>,
) {
  return async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    // Ahead of everything, including the health check below: the static
    // branch's SPA fallback answers any unmatched path with index.html and a
    // 200, so a blob route mounted after it would return HTML to an <audio>
    // element rather than a 404. The health-check branch returns early, so
    // this must also precede it or blobs would break whenever no web-client
    // bundle is staged (which is how both server test harnesses run).
    if (handleBlobRequest && (await handleBlobRequest(request, response))) {
      return
    }

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

/**
 * Stands in when no blob store is configured. It still *claims* the `/blobs`
 * paths so they can never fall through to the SPA fallback and come back as a
 * 200 page of HTML.
 */
async function unavailableBlobRequestHandler(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<boolean> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname !== '/blobs' && !pathname.startsWith('/blobs/')) {
    return false
  }
  request.resume()
  response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ error: 'Blob store not configured' }))
  return true
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

  const {
    storagePath,
    host,
    peerId,
    webClientPath,
    tls,
    webAppDevUrl,
    blobStorePath,
    blobToken,
  } = options
  const requestedPort = options.port ?? DEFAULT_SYNC_SERVER_PORT

  const blobStore = blobStorePath ? createBlobStore(blobStorePath) : undefined
  if (blobStore) {
    // Best-effort: a failed sweep must not stop the server from starting.
    void blobStore
      .sweepTmp(TMP_SWEEP_MAX_AGE_MS)
      .catch((error) => console.error('Blob tmp sweep failed:', error))
  }

  const handleBlobRequest = blobStore
    ? createBlobRequestHandler({ store: blobStore, token: blobToken })
    : unavailableBlobRequestHandler

  const handler = createRequestHandler(webClientPath, handleBlobRequest)
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
      webAppUrl:
        webAppDevUrl ??
        (webClientPath ? `${httpScheme}://127.0.0.1:${port}` : undefined),
      lanWebAppUrl:
        webAppDevUrl ??
        (webClientPath && lanIp
          ? `${httpScheme}://${lanIp}:${port}`
          : undefined),
      // Blobs are always served by this process, never by the web-client's
      // dev server, so these ignore `webAppDevUrl`. In development the dev
      // server proxies `/blobs` back here (see web-client's vite.config.ts).
      blobBaseUrl: blobStore ? `${httpScheme}://127.0.0.1:${port}` : undefined,
      lanBlobBaseUrl:
        blobStore && lanIp ? `${httpScheme}://${lanIp}:${port}` : undefined,
      blobToken: blobStore ? blobToken : undefined,
      port,
      host,
    },
    repo,
    wss,
    server,
    blobStore,
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
  // `server.close` only stops new connections; it waits for existing ones to
  // end. Now that guests hold keep-alive HTTP connections for `/blobs`, that
  // wait runs to the keep-alive timeout and stalls quitting the app (main.ts
  // defers `will-quit` on this).
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
