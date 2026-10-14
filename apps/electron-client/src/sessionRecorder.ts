import { Readable } from 'stream'
import {
  STATEMENT_MIME_TYPE,
  createSessionRecord,
  statementBytes,
  type RecordingClaim,
  type SessionDevice,
  type SessionSpan,
} from '@tapes-monorepo/provenance'
import type { BlobStore } from './blobStore'
import type { SyncConnection } from './syncConnections'

/**
 * Follows one open session on the host and signs its record when it closes.
 * The record lists the proven device keys that were connected, with their
 * spans, and the recording claims accepted for the session.
 *
 * A claim counts when its session ID matches and it is verified while the
 * session is open or within a grace period after it closes. A take that runs
 * past the stop uploads after it, and still belongs to the session it began
 * in. Connections stop counting at the close.
 *
 * Do not import `electron` here, so this stays testable in a plain node
 * process.
 */

/** How long a closed session keeps accepting claims before it is signed. */
export const DEFAULT_SESSION_GRACE_MS = 60_000

export type OpenSession = { sessionId: string; openedAt: number }

export type SessionRecorder = {
  /**
   * Opens a session. `docUrl` is the root document that owns the stored
   * record. Throws while another session is open.
   */
  open(details: { sessionId: string; docUrl: string }): OpenSession
  /** The open session, or undefined. Sessions in their grace period are closed. */
  current(): OpenSession | undefined
  /** Feeds the host's connection list, as the registry emits it. */
  connectionsChanged(connections: SyncConnection[]): void
  /** Tells the recorder the host verified a claim. */
  claimVerified(claim: RecordingClaim, claimAddress: string): void
  /**
   * Closes the open session and resolves with the stored record's hash once it
   * is signed, after the grace period. Resolves undefined when nothing was open
   * or the record could not be signed or stored.
   */
  close(options?: { graceMs?: number }): Promise<string | undefined>
  /**
   * Closes the open session and ends every grace period now, then waits for
   * the records to be signed. For quitting, when a timer would never fire.
   */
  flush(): Promise<void>
}

type Span = { joinedAt: number; leftAt?: number }

type Tracked = {
  session: OpenSession
  docUrl: string
  /** Proven device keys, with their spans and the last label each gave. */
  devices: Map<string, { label?: string; spans: Span[] }>
  /** Open spans by connection id, so a disconnect can end the right one. */
  live: Map<string, Span>
  claims: Set<string>
}

export function createSessionRecorder({
  loadSigningKey,
  getStore,
  getConnections,
  graceMs: defaultGraceMs = DEFAULT_SESSION_GRACE_MS,
  now = Date.now,
  wait = (ms) =>
    new Promise((resolve) => {
      // A grace period must never be what keeps the process up.
      setTimeout(resolve, ms).unref?.()
    }),
}: {
  loadSigningKey: () => Promise<CryptoKeyPair>
  /** The running host's blob store. Read when the record is stored. */
  getStore: () => BlobStore | undefined
  /** Who is connected right now, for a session opened mid-connection. */
  getConnections: () => SyncConnection[]
  graceMs?: number
  now?: () => number
  wait?: (ms: number) => Promise<void>
}): SessionRecorder {
  let open: Tracked | undefined
  // Closed sessions still in their grace period, by session ID.
  const closing = new Map<
    string,
    { tracked: Tracked; skipGrace: () => void; signed: Promise<unknown> }
  >()

  const track = (tracked: Tracked, connections: SyncConnection[]) => {
    const at = now()
    const present = new Set<string>()
    for (const connection of connections) {
      if (!connection.deviceKey) {
        continue
      }
      present.add(connection.id)
      const device = tracked.devices.get(connection.deviceKey) ?? { spans: [] }
      device.label = connection.label ?? device.label
      tracked.devices.set(connection.deviceKey, device)
      if (!tracked.live.has(connection.id)) {
        // A connection already up when the session opened joins at the open.
        const span = {
          joinedAt: Math.max(connection.connectedAt, tracked.session.openedAt),
        }
        tracked.live.set(connection.id, span)
        device.spans.push(span)
      }
    }
    for (const [id, span] of tracked.live) {
      if (!present.has(id)) {
        span.leftAt = at
        tracked.live.delete(id)
      }
    }
  }

  const sign = async (tracked: Tracked, closedAt: number) => {
    const store = getStore()
    if (!store) {
      throw new Error('Blob store is not available')
    }
    const record = await createSessionRecord(
      {
        sessionId: tracked.session.sessionId,
        openedAt: new Date(tracked.session.openedAt),
        closedAt: new Date(closedAt),
        devices: [...tracked.devices].map(
          ([deviceKey, { label, spans }]): SessionDevice => ({
            deviceKey,
            ...(label === undefined ? {} : { label }),
            spans: spans.map((span): SessionSpan => ({
              joinedAt: new Date(span.joinedAt).toISOString(),
              leftAt: new Date(span.leftAt ?? closedAt).toISOString(),
            })),
          }),
        ),
        claims: [...tracked.claims],
      },
      await loadSigningKey(),
    )
    const { meta } = await store.ingestStream(
      Readable.from([Buffer.from(statementBytes(record))]),
      { mimeType: STATEMENT_MIME_TYPE, ext: '.json', docUrl: tracked.docUrl },
    )
    return meta.hash
  }

  const close: SessionRecorder['close'] = async ({
    graceMs = defaultGraceMs,
  } = {}) => {
    const tracked = open
    if (!tracked) {
      return undefined
    }
    open = undefined
    const closedAt = now()
    for (const span of tracked.live.values()) {
      span.leftAt = closedAt
    }
    tracked.live.clear()

    let skipGrace = () => {}
    const skipped = new Promise<void>((resolve) => {
      skipGrace = resolve
    })
    const signed = (async () => {
      try {
        if (graceMs > 0) {
          await Promise.race([wait(graceMs), skipped])
        }
        return await sign(tracked, closedAt)
      } catch (error) {
        console.error(
          `Could not sign the record for session ${tracked.session.sessionId}:`,
          error,
        )
        return undefined
      } finally {
        closing.delete(tracked.session.sessionId)
      }
    })()
    closing.set(tracked.session.sessionId, { tracked, skipGrace, signed })
    return signed
  }

  return {
    open({ sessionId, docUrl }) {
      if (open) {
        throw new Error(`Session ${open.session.sessionId} is already open`)
      }
      if (closing.has(sessionId)) {
        throw new Error(`Session ${sessionId} is still closing`)
      }
      open = {
        session: { sessionId, openedAt: now() },
        docUrl,
        devices: new Map(),
        live: new Map(),
        claims: new Set(),
      }
      track(open, getConnections())
      return open.session
    },

    current() {
      return open?.session
    },

    connectionsChanged(connections) {
      if (open) {
        track(open, connections)
      }
    },

    claimVerified(claim, claimAddress) {
      const tracked =
        open?.session.sessionId === claim.sessionId
          ? open
          : closing.get(claim.sessionId)?.tracked
      tracked?.claims.add(claimAddress)
    },

    close,

    async flush() {
      void close({ graceMs: 0 })
      const pending = [...closing.values()]
      for (const { skipGrace } of pending) {
        skipGrace()
      }
      await Promise.all(pending.map(({ signed }) => signed))
    },
  }
}
