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
import { createCaRequestHandler, TRUST_PAGE_PATH } from './caHttp'
import { isAuthorized } from './tokenAuth'
import { readDeviceLabel, UNNAMED_DEVICE_LABEL } from './deviceLabel'
import {
  createSyncConnectionRegistry,
  type SyncConnection,
  type SyncConnectionRegistry,
} from './syncConnections'
import {
  createSyncChallengeRequestHandler,
  createSyncChallengeStore,
  readProvenDeviceKey,
} from './syncChallenges'
import { createSessionRecorder, type OpenSession } from './sessionRecorder'
import { listSessionRecord } from './sessionDelivery'
import { listDeviceRevocation } from './vouchRevocation'
import { createHostSession } from './hostSession'
import { FALLBACK_HOST_LABEL } from './computerName'
import {
  createHostVouching,
  type HostVouching,
  type PendingVouch,
} from './hostVouching'
import { createPasskeyRecordStore } from './passkeyRecords'
import { createPasskeyRecordHandler } from './passkeyRecordsHttp'
import { createPersonRoster } from './personRoster'
import { isRevokedDeviceKey } from './revokedDeviceKeys'
import { createVouchRequestHandler } from './vouchHttp'
import {
  hasHostClientMarker,
  SYNC_CLOSE_REVOKED,
  SYNC_CLOSE_REVOKED_REASON,
} from '@tapes-monorepo/sync-protocol'
import {
  exportPublicKey,
  type RecordingClaim,
} from '@tapes-monorepo/provenance'
import { type SyncServerInfo } from '@tapes-monorepo/core'

export type { SyncConnection } from './syncConnections'

export const DEFAULT_SYNC_SERVER_PORT = 9001

/** Uploads abandoned mid-stream are cleared once they are a day old. */
const TMP_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000

type SyncServerOptions = {
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
   * Self-signed key and cert. When provided the server runs over HTTPS and the
   * sync socket over `wss://` on the same port. A guest then gets a secure
   * context, which recording and OPFS-backed playback both require, and the
   * socket handshake reuses the cert exception the guest already accepted.
   */
  tls?: { key: string; cert: string }
  /**
   * The host's root certificate PEM, served at `/ca.crt` so a guest can install
   * it and stop seeing the warning. Only ever the certificate: the root's
   * private key must never reach this process's HTTP surface. Undefined when
   * the server is not running over TLS, and the route then answers 503.
   */
  rootCertPem?: string
  /**
   * In development, the LAN url of the web-client's Vite dev server. When set
   * it is advertised to guests instead of the statically served bundle, so they
   * load the HMR-enabled app. The sync socket still runs here, and the dev
   * server proxies `/sync` back to it.
   */
  webAppDevUrl?: string
  /**
   * Root of the content-addressed audio store. When omitted the `/blobs`
   * routes still match but answer 503, so the server and its tests keep
   * working without one.
   */
  blobStorePath?: string
  /**
   * Root of the append-only playback-event log. Tests that do not care about
   * events omit it. The ingest route then answers 503, as `/blobs` does
   * without a blob store.
   */
  eventStorePath?: string
  /**
   * Bearer token guarding `/blobs` and the sync socket's upgrade. Omitted only
   * by tests that exercise the unauthenticated shape; the app always has one.
   */
  pairingToken?: string
  /**
   * SHA-256 of the root that issued `tls.cert`, in colon-separated pairs.
   * Passed in rather than read here so this module stays free of the
   * certificate store.
   */
  rootCertFingerprint?: string
  /**
   * The Mac's own name. Passed in so this module does not shell out. It is the
   * host's name until the user sets one.
   */
  computerName?: string
  /**
   * Where the roster of people is kept. Without it, or without a signing key,
   * the roster and vouch routes are not mounted.
   */
  rosterPath?: string
  /**
   * The host's provenance signing key, for receipts on uploaded recordings.
   * Passed in because loading it needs electron, which this module avoids.
   */
  loadSigningKey?: () => Promise<CryptoKeyPair>
}

type RunningSyncServer = {
  info: SyncServerInfo
  repo: Repo
  wss: WebSocketServer
  server: http.Server
  connections: SyncConnectionRegistry
  blobStore?: BlobStore
  eventStore?: EventStore
  aggregateStore?: AggregateStore
  loadSigningKey?: () => Promise<CryptoKeyPair>
  vouching?: HostVouching
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
 * Listeners on the connection list. They live at module scope rather than on
 * the running server, so a subscriber set up once at startup keeps hearing
 * changes across a restart of the server (the LAN and HTTPS toggles both
 * restart it). An empty list is emitted while nothing is running.
 */
const connectionListeners = new Set<(connections: SyncConnection[]) => void>()

function emitConnections(connections: SyncConnection[]) {
  for (const listener of connectionListeners) {
    try {
      listener(connections)
    } catch (error) {
      console.error('Sync connection listener failed:', error)
    }
  }
}

/**
 * Listeners on the requests waiting for the operator. At module scope for the
 * same reason as the connection listeners above.
 */
const pendingVouchListeners = new Set<(pending: PendingVouch[]) => void>()

function emitPendingVouches(pending: PendingVouch[]) {
  for (const listener of pendingVouchListeners) {
    try {
      listener(pending)
    } catch (error) {
      console.error('Pending vouch listener failed:', error)
    }
  }
}

export function subscribeToPendingVouches(
  listener: (pending: PendingVouch[]) => void,
): () => void {
  pendingVouchListeners.add(listener)
  return () => {
    pendingVouchListeners.delete(listener)
  }
}

/** The running host's vouching, for the operator's IPC channels. */
export function getHostVouching(): HostVouching | undefined {
  return current?.vouching
}

/** Who is connected to the running host right now, oldest first. */
export function getSyncConnections(): SyncConnection[] {
  return current?.connections.list() ?? []
}

/**
 * The host's session, at module scope like the listeners above, so a session
 * stays open across a restart of the server. Connections drop during the
 * restart and rejoin as new spans.
 */
const sessions = createSessionRecorder({
  loadSigningKey: () => {
    const load = current?.loadSigningKey
    if (!load) {
      throw new Error('No host signing key while the sync server is stopped')
    }
    return load()
  },
  getStore: () => current?.blobStore,
  getConnections: getSyncConnections,
  onSigned: async (details) => {
    const repo = current?.repo
    if (!repo) {
      throw new Error('No repo while the sync server is stopped')
    }
    return listSessionRecord(repo, details)
  },
})
connectionListeners.add((connections) =>
  sessions.connectionsChanged(connections),
)

/**
 * Opens a session. `docUrl` is the root document that owns its record. Throws
 * while another session is open.
 */
export function openSession(details: {
  sessionId: string
  docUrl: string
}): OpenSession {
  return sessions.open(details)
}

export function getOpenSession(): OpenSession | undefined {
  return sessions.current()
}

/**
 * Closes the open session. Resolves with the stored record's hash after the
 * grace period for late uploads, or undefined if it could not be signed.
 */
export function closeSession(): Promise<string | undefined> {
  return sessions.close()
}

/**
 * The session the renderer starts and stops over IPC, published in the root
 * document. It drives the recorder above.
 */
export const hostSession = createHostSession({
  sessions,
  getRepo: () => getSyncRepo(),
})

/** Signs every open and closing session now. Call before stopping to quit. */
export function flushSessions(): Promise<void> {
  return sessions.flush()
}

/** For ingest paths outside `/blobs`, such as the host's own recordings. */
export function noteVerifiedClaim(
  claim: RecordingClaim,
  claimAddress: string,
): void {
  sessions.claimVerified(claim, claimAddress)
}

/**
 * Subscribes to connects, disconnects and keepalive evictions. Returns the
 * unsubscribe. The listener is not called with the current list on
 * subscription; pair it with `getSyncConnections` for the snapshot.
 */
export function onSyncConnectionsChange(
  listener: (connections: SyncConnection[]) => void,
): () => void {
  connectionListeners.add(listener)
  return () => {
    connectionListeners.delete(listener)
  }
}

/**
 * The running host's blob store, for the IPC channels that ingest a locally
 * recorded file without going over HTTP.
 */
export function getBlobStore(): BlobStore | undefined {
  return current?.blobStore
}

/**
 * The running host's repo, for the blob GC's walk from the root documents.
 * The only other readers are the session code: the recorder lists a signed
 * record on its recordings, and the host session publishes the open session.
 * Keep this narrow rather than a general seam for interpreting docs in main.
 */
export function getSyncRepo(): Repo | undefined {
  return current?.repo
}

/**
 * The running host's playback-event log, for the ingest route and for deriving
 * aggregates. Undefined until the server has opened it, since a store whose
 * dedupe index has not loaded would re-admit events already on disk.
 *
 * This is only ever this device's own log, as `getBlobStore` is only its own
 * store. See the caveat on `getAggregateStore`.
 */
export function getEventStore(): EventStore | undefined {
  return current?.eventStore
}

/**
 * Per-recording plays and average completion, derived from that log.
 *
 * These numbers only describe events this device accepted. A device can be a
 * host and a guest of another host at once, and its own plays flush to
 * whichever host it syncs with. A read path that answers the renderer from
 * here unconditionally reports zeros for a library whose events went
 * elsewhere. The blob endpoints had the same bug in remote sync mode.
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
 * Builds the HTTP request handler. With `webClientPath` set it serves the built
 * web-client bundle, falling back to index.html so deep links like `/?am=<url>`
 * work. Without it, it answers a plain health check.
 */
function createRequestHandler(
  webClientPath?: string,
  routes: RouteHandler[] = [],
) {
  return async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    // API routes run first, ahead of the health check and the static handler.
    // The SPA fallback answers any unmatched path with index.html and a 200, so
    // a route mounted after it would hand HTML to an audio element or to a
    // flushing event queue instead of a 404. The health check returns early,
    // so routes must also precede it or they would break whenever no bundle is
    // staged, which is how both server test harnesses run.
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
 * Stands in when no blob store is configured. It still claims the `/blobs`
 * paths so they never fall through to the SPA fallback and come back as HTML.
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
 * The same stand-in for `/events`. The path has to be claimed even with no log
 * behind it, or a flushing client would read the SPA fallback's 200 as
 * "accepted" and clear its queue.
 */
async function unavailableEventRequestHandler(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<boolean> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  // The read route is answered here too. Without it, the request falls through
  // to the static handler, which returns a page of HTML with a 200. A client
  // reads that as a broken host rather than one with no event store.
  if (pathname !== '/events' && pathname !== '/events/aggregates') {
    return false
  }
  request.resume()
  response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ error: 'Event store not configured' }))
  return true
}

/**
 * Whether this host holds the document a reported play names.
 *
 * Answered with a file check on the storage adapter's layout rather than a
 * repo lookup, because the check runs for every event of every ingest and
 * resolving a document would load and merge it. Only positives are cached. A
 * miss is often temporary, since a guest that played offline can reach
 * `/events` before its recording has synced here. The route treats that as
 * retryable.
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
      // The first two characters of the id name a directory holding the rest.
      // The same layout `blobGc.ts` walks.
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

/**
 * Whether an address is this machine talking to itself. Used only to qualify a
 * self-reported host claim, never to authorize anything.
 */
function isLoopback(address?: string): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

/**
 * Whether a sync request is this host's own window. A guest can send the
 * claim too, so it only counts from loopback. That still admits another
 * program on this machine, which is the honest answer anyway: the row means
 * this machine, not this window.
 */
function isSelf(request: http.IncomingMessage, url: URL): boolean {
  return hasHostClientMarker(url) && isLoopback(request.socket.remoteAddress)
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
    rootCertPem,
    webAppDevUrl,
    blobStorePath,
    eventStorePath,
    pairingToken,
    rootCertFingerprint,
    computerName,
    rosterPath,
    loadSigningKey,
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
      // Retention runs at startup, alongside the tmp sweep, rather than on a
      // timer. A host that never restarts for 90 days is not a case this app
      // has. It goes through the aggregate store when there is one, so expiring
      // events are folded into the frozen baseline before they are unlinked.
      // Without one the raw sweep still runs, since a log that grows forever is
      // the worse failure, and those plays are lost.
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
    ? createBlobRequestHandler({
        store: blobStore,
        token: pairingToken,
        loadSigningKey,
        onVerifiedClaim: noteVerifiedClaim,
      })
    : unavailableBlobRequestHandler

  const challenges = createSyncChallengeStore()

  const roster = rosterPath ? createPersonRoster(rosterPath) : undefined

  // A record needs no host signature, so this stands even where the host has
  // no signing key of its own.
  const passkeyRecords = roster
    ? createPasskeyRecordStore({
        roster,
        consumeChallenge: (challenge) => challenges.consume(challenge),
      })
    : undefined

  const vouching =
    roster && loadSigningKey
      ? createHostVouching({
          roster,
          loadSigningKey,
          // The host's own window presents the name the user gave the host.
          hostLabel: () =>
            connections.list().find((connection) => connection.self)?.label ??
            computerName ??
            FALLBACK_HOST_LABEL,
          consumeChallenge: (challenge) => challenges.consume(challenge),
          // Read from the running server rather than captured here: the repo
          // and the store are built further down, and a restart replaces both.
          deliverRevocation: async (details) => {
            const repo = current?.repo
            const store = current?.blobStore
            if (!repo || !store) {
              throw new Error(
                'No repo or blob store for a revocation while the sync server is stopped',
              )
            }
            return listDeviceRevocation(repo, store, details)
          },
          onChange: () => emitPendingVouches(vouching?.pending() ?? []),
        })
      : undefined

  const handleEventRequest = eventStore
    ? createEventRequestHandler({
        store: eventStore,
        // Undefined when the totals failed to open. Reads then answer 503
        // rather than an empty library, which would look like no plays.
        aggregates: aggregateStore,
        token: pairingToken,
        isKnownRecording: createKnownRecordingCheck(storagePath),
      })
    : unavailableEventRequestHandler

  const handler = createRequestHandler(webClientPath, [
    handleBlobRequest,
    handleEventRequest,
    createSyncChallengeRequestHandler({ challenges, token: pairingToken }),
    ...(vouching
      ? [createVouchRequestHandler({ vouching, token: pairingToken })]
      : []),
    ...(passkeyRecords
      ? [
          createPasskeyRecordHandler({
            records: passkeyRecords,
            token: pairingToken,
          }),
        ]
      : []),
    createCaRequestHandler({ rootCertPem }),
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
  // repo. Without it, anyone who can route to this port reaches the root
  // document and can read or rewrite every recording in it.
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (!isAuthorized(request, url, pairingToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    // Read on the upgrade, not after the connection is up, so the host has a
    // name for every connection it accepts. The name is self-reported and
    // grants nothing on its own.
    const deviceLabel = readDeviceLabel(request, url)
    void deviceKeyFor(request, url).then(async (deviceKey) => {
      if (deviceKey && (await isRevoked(deviceKey))) {
        // The handshake is completed only to close it, so the guest reads a
        // code instead of a bare network error. `connection` is never emitted,
        // so the repo and the connection list never see this socket.
        wss.handleUpgrade(request, socket, head, (client) => {
          console.warn(
            `Refused a revoked device: ${deviceLabel ?? UNNAMED_DEVICE_LABEL}`,
          )
          client.close(SYNC_CLOSE_REVOKED, SYNC_CLOSE_REVOKED_REASON)
        })
        return
      }
      deviceKeys.set(request, deviceKey)
      wss.handleUpgrade(request, socket, head, (client) => {
        console.info(
          `Sync guest connected: ${deviceLabel ?? UNNAMED_DEVICE_LABEL}`,
        )
        wss.emit('connection', client, request)
      })
    })
  })

  /**
   * Never rejects. A roster this host cannot read says nothing about any
   * device, and turning every guest away over it would be worse than letting
   * a revoked one in.
   */
  const isRevoked = async (deviceKey: string): Promise<boolean> => {
    if (!roster) {
      return false
    }
    try {
      return await isRevokedDeviceKey(roster, deviceKey)
    } catch (error) {
      console.warn('Could not check a device key against the roster:', error)
      return false
    }
  }

  // The key each upgrade proved, for the `connection` handler below.
  const deviceKeys = new WeakMap<http.IncomingMessage, string | undefined>()

  // The host's own window does not sign a challenge. Its recordings are signed
  // with the host key, so that is the key it is listed under.
  let hostKey: Promise<string | undefined> | undefined
  const loadHostKey = () =>
    (hostKey ??= (async () =>
      loadSigningKey
        ? exportPublicKey((await loadSigningKey()).publicKey)
        : undefined)().catch((error: unknown) => {
      hostKey = undefined
      console.warn('Could not load the host key for its own window:', error)
      return undefined
    }))

  // Never rejects. A connection without a proven key is still served.
  const deviceKeyFor = async (
    request: http.IncomingMessage,
    url: URL,
  ): Promise<string | undefined> => {
    if (isSelf(request, url)) {
      return loadHostKey()
    }
    try {
      return await readProvenDeviceKey(url, challenges)
    } catch (error) {
      console.warn('Could not check a sync proof:', error)
      return undefined
    }
  }

  const connections = createSyncConnectionRegistry({
    onChange: emitConnections,
  })

  // Registered on the server's own `connection` event, not inside the upgrade
  // handler above, so the registry holds exactly the sockets the server
  // considers open. The name and the host claim are read off the same request,
  // as they were at upgrade.
  wss.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    connections.add(socket, {
      label: readDeviceLabel(request, url),
      address: request.socket.remoteAddress,
      self: isSelf(request, url),
      deviceKey: deviceKeys.get(request),
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
  // Guests pin this key from the QR link and check every vouch against it.
  const publicHostKey = await loadHostKey()

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
      // Advertised only with TLS on. Over plain HTTP there is no certificate,
      // and pointing anyone at a page that would answer 503 helps nobody.
      trustPageUrl: tls
        ? `${httpScheme}://127.0.0.1:${port}${TRUST_PAGE_PATH}`
        : undefined,
      lanTrustPageUrl:
        tls && lanIp
          ? `${httpScheme}://${lanIp}:${port}${TRUST_PAGE_PATH}`
          : undefined,
      pairingToken,
      // Only meaningful with TLS on: without it there is no root for a guest
      // to install, so there is nothing to compare.
      rootCertFingerprint: tls ? rootCertFingerprint : undefined,
      computerName,
      hostKey: publicHostKey,
      port,
      host,
    },
    repo,
    wss,
    server,
    connections,
    blobStore,
    eventStore,
    aggregateStore,
    loadSigningKey,
    vouching,
  }

  console.log(`Sync server listening on ${wsScheme}://${host}:${port}`)

  return current.info
}

export async function stopSyncServer(): Promise<void> {
  if (!current) {
    return
  }
  const { repo, wss, server, connections } = current
  current = null

  // Before the sockets are torn down, so the list empties once rather than
  // draining socket by socket as each `close` fires.
  connections.close()
  // Waiting requests live with the server, so a restart starts with none.
  emitPendingVouches([])

  await repo.flush()
  for (const client of wss.clients) {
    client.terminate()
  }
  await new Promise<void>((resolve) => wss.close(() => resolve()))
  // `server.close` only stops new connections and waits for existing ones to
  // end. Guests hold keep-alive HTTP connections for blobs, so that wait would
  // run to the keep-alive timeout and stall quitting. main.ts defers quitting
  // on this call.
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
