import http from 'http'
import https from 'https'
import os from 'os'
import path from 'path'
import { access, readFile } from 'fs/promises'
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
import {
  createEventStore,
  DEFAULT_EVENT_MAX_AGE_MS,
  type EventStore,
} from './eventStore'
import { createAggregateStore, type AggregateStore } from './aggregates'
import { createBlobRequestHandler } from './blobHttp'
import { createEventRequestHandler } from './eventHttp'
import { isAuthorized } from './tokenAuth'

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
   * Bearer token guarding both `/blobs` and the sync socket. Handed to guests
   * through the QR pairing URL; never log this object wholesale.
   */
  pairingToken?: string
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
  /**
   * Root of the append-only playback-event log. Omitted by tests that have no
   * interest in events; the ingest route answers 503 without one, exactly as
   * `/blobs` does without a blob store.
   */
  eventStorePath?: string
  /**
   * Bearer token guarding `/blobs` and the sync socket's upgrade. Omitted only
   * by tests that exercise the unauthenticated shape; the app always has one.
   */
  pairingToken?: string
}

type RunningSyncServer = {
  info: SyncServerInfo
  repo: Repo
  wss: WebSocketServer
  server: http.Server
  blobStore?: BlobStore
  eventStore?: EventStore
  aggregateStore?: AggregateStore
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

/**
 * The running host's repo, for the blob GC's walk over the library graph.
 *
 * Nothing else on the host reads document contents — the server otherwise only
 * relays and persists — so this stays deliberately narrow rather than becoming
 * a general seam for interpreting docs in the main process.
 */
export function getSyncRepo(): Repo | undefined {
  return current?.repo
}

/**
 * The running host's playback-event log, for the ingest route and for deriving
 * aggregates. Undefined until `startSyncServer` has opened it — a store whose
 * dedupe index has not loaded would re-admit events already on disk.
 *
 * **This is only ever *this device's own* log**, exactly as `getBlobStore` is
 * only its own store. A device can be a host and a guest of another host at the
 * same time (`SyncServerUrls` in `rendererRepo.ts` syncs a remote server *in
 * addition to* the local one), and its own plays are flushed to whichever host
 * it is synced with — which may not be this one. A read path that answers the
 * renderer from here unconditionally will report zeros for a library whose
 * events all went elsewhere: the same failure mode TAP-74 fixed for blobs.
 */
export function getEventStore(): EventStore | undefined {
  return current?.eventStore
}

/**
 * Per-recording plays and average completion, derived from that log.
 *
 * Carries the same caveat as `getEventStore`, and more visibly: these numbers
 * only ever describe the events *this* device accepted. A device that is a
 * guest of another host flushes its plays there, so a read path that answers
 * the renderer from here unconditionally will report zeros for a library whose
 * events all went elsewhere.
 */
export function getAggregateStore(): AggregateStore | undefined {
  return current?.aggregateStore
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
 * An API route: answers the request and returns true, or declines it with
 * false so the next one (and ultimately the static handler) gets a look.
 */
type RouteHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
) => Promise<boolean>

/**
 * Builds the HTTP request handler. When `webClientPath` is set it serves the
 * built web-client bundle (with an SPA fallback to index.html so deep links
 * like `/?am=<url>` work); otherwise it responds with a plain health check.
 */
function createRequestHandler(
  webClientPath?: string,
  routes: RouteHandler[] = [],
) {
  return async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    // Ahead of everything, including the health check below: the static
    // branch's SPA fallback answers any unmatched path with index.html and a
    // 200, so an API route mounted after it would return HTML to an <audio>
    // element (or to a flushing event queue) rather than a 404. The
    // health-check branch returns early, so this must also precede it or the
    // routes would break whenever no web-client bundle is staged (which is how
    // both server test harnesses run).
    for (const route of routes) {
      if (await route(request, response)) {
        return
      }
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

/**
 * The same stand-in for `/events`, and for the same reason: the path has to be
 * claimed even when there is no log behind it, or a flushing client would read
 * the SPA fallback's 200 as "accepted" and clear its queue.
 */
async function unavailableEventRequestHandler(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<boolean> {
  if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/events') {
    return false
  }
  request.resume()
  response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ error: 'Event store not configured' }))
  return true
}

/**
 * Whether this host holds the document a reported play names, read straight
 * off `NodeFSStorageAdapter`'s layout — the first two characters of the id
 * name a directory holding the rest, the same layout `blobGc.ts` walks.
 *
 * A `stat` rather than a `repo.find`: the check runs per event of every
 * ingest, and resolving a document would mean loading and merging it. This
 * answers the only question the route actually asks — is this a recording this
 * host has ever heard of, or a fabricated id.
 *
 * Only positives are cached. A document that is present stays present for the
 * life of the process, but a miss is frequently temporary: a guest that played
 * offline can reach `/events` before its recording has finished syncing here,
 * which is why the route treats that rejection as retryable.
 */
function createKnownRecordingCheck(storagePath: string) {
  const known = new Set<string>()

  return async function isKnownRecording(recordingUrl: string) {
    if (known.has(recordingUrl)) {
      return true
    }
    const documentId = recordingUrl.slice('automerge:'.length)
    if (documentId.length < 3) {
      return false
    }
    try {
      await access(
        path.join(storagePath, documentId.slice(0, 2), documentId.slice(2)),
      )
    } catch {
      return false
    }
    known.add(recordingUrl)
    return true
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

  const {
    storagePath,
    host,
    peerId,
    webClientPath,
    tls,
    webAppDevUrl,
    blobStorePath,
    eventStorePath,
    pairingToken,
  } = options
  const requestedPort = options.port ?? DEFAULT_SYNC_SERVER_PORT

  const blobStore = blobStorePath ? createBlobStore(blobStorePath) : undefined
  if (blobStore) {
    // Best-effort: a failed sweep must not stop the server from starting.
    void blobStore
      .sweepTmp(TMP_SWEEP_MAX_AGE_MS)
      .catch((error) => console.error('Blob tmp sweep failed:', error))
  }

  // Opening the log is awaited, unlike the sweeps around it: the dedupe index
  // has to be loaded before the first ingest can be answered, or events
  // already on disk would be taken a second time. A store that cannot open is
  // left out entirely rather than served empty, for the same reason.
  let eventStore: EventStore | undefined
  let aggregateStore: AggregateStore | undefined
  if (eventStorePath) {
    const store = createEventStore(eventStorePath)
    try {
      const indexed = await store.open()
      eventStore = store
      // Aggregates open with the log, not lazily on first read: the rollup is
      // derived by replaying the log, and doing that on the first request would
      // put a full 90-day read on a path that is meant to be a map lookup.
      const aggregates = createAggregateStore(eventStorePath, store)
      try {
        const recordings = await aggregates.open()
        aggregateStore = aggregates
        console.info(
          `Playback aggregates: ${recordings} recording(s) from ` +
            `${indexed} event(s).`,
        )
      } catch (error) {
        // The log is still servable without them; reads answer undefined and a
        // later `rebuild` can recover, which is the point of deriving.
        console.error('Playback aggregates failed to open:', error)
      }
      // Retention rides the same startup moment as the tmp sweep rather than
      // getting a timer of its own; a host that never restarts for 90 days is
      // not a case this app has.
      //
      // It goes through the aggregate store when there is one: expiring events
      // have to be folded into the frozen baseline *before* they are unlinked,
      // or an old tape's lifetime play count would decay as its events aged
      // out. Without one, the raw sweep still runs — a log that grows forever
      // is the worse failure — and those plays are simply lost.
      void (aggregateStore ?? store)
        .sweep(DEFAULT_EVENT_MAX_AGE_MS)
        .then(({ segments, events, retained }) => {
          if (segments.length > 0) {
            console.info(
              `Event log: swept ${events} event(s) past retention in ` +
                `${segments.length} segment(s); ${store.size()} of ${indexed} ` +
                `remain.`,
            )
          }
          if (retained.length > 0) {
            console.warn(
              `Event log: kept ${retained.length} expired segment(s) that ` +
                `could not be folded into the aggregate baseline.`,
            )
          }
        })
        .catch((error) => console.error('Event log sweep failed:', error))
    } catch (error) {
      console.error('Event log failed to open:', error)
    }
  }

  const handleBlobRequest = blobStore
    ? createBlobRequestHandler({ store: blobStore, token: pairingToken })
    : unavailableBlobRequestHandler

  const handleEventRequest = eventStore
    ? createEventRequestHandler({
        store: eventStore,
        token: pairingToken,
        isKnownRecording: createKnownRecordingCheck(storagePath),
      })
    : unavailableEventRequestHandler

  const handler = createRequestHandler(webClientPath, [
    handleBlobRequest,
    handleEventRequest,
  ])
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

  // `noServer` rather than `{ server }`: the upgrade has to be answered by
  // hand so the pairing token can be checked before a peer ever reaches the
  // repo. Without it, anyone who can route to this port joins the library and
  // can read or rewrite every recording in it.
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (!isAuthorized(request, url, pairingToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request)
    })
  })

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
      pairingToken,
      port,
      host,
    },
    repo,
    wss,
    server,
    blobStore,
    eventStore,
    aggregateStore,
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
