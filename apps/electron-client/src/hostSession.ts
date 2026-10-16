import { randomUUID } from 'crypto'
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo/slim'
import type { PublishedSession, RootDocument } from '@tapes-monorepo/core'
import type { OpenSession, SessionRecorder } from './sessionRecorder'

/**
 * Starts and stops the host's session and publishes it in the root document's
 * `session` field. This module is the only writer of that field. The renderer
 * asks over IPC instead of writing the field itself.
 *
 * Session state lives in memory, so a crash leaves the field set with no
 * session behind it. `clearStale` removes such a field.
 *
 * Do not import `electron` here, so this stays testable in a plain node
 * process.
 */

/** As in `blobGc.ts`: `find` can stay pending forever without a deadline. */
const DEFAULT_FIND_TIMEOUT_MS = 5_000

export type HostSession = {
  /** Opens a session on `docUrl` and publishes it. Throws while one is open. */
  start(docUrl: string): Promise<PublishedSession>
  /**
   * Closes the open session and clears the field. The record is signed later,
   * after the recorder's grace period. Does nothing when no session is open.
   */
  stop(): Promise<void>
  current(): PublishedSession | undefined
  /** Clears `docUrl`'s field unless it names the open session. */
  clearStale(docUrl: string): Promise<void>
}

export function createHostSession({
  sessions,
  getRepo,
  newSessionId = randomUUID,
  findTimeoutMs = DEFAULT_FIND_TIMEOUT_MS,
}: {
  sessions: Pick<SessionRecorder, 'open' | 'close' | 'current'>
  /** The running host's repo. Undefined while the sync server is stopped. */
  getRepo: () => Repo | undefined
  newSessionId?: () => string
  findTimeoutMs?: number
}): HostSession {
  // The recorder knows the open session but not which doc published it.
  let publishedIn: { sessionId: string; docUrl: string } | undefined

  const findRoot = async (docUrl: string) => {
    const repo = getRepo()
    if (!repo) {
      throw new Error('No repo while the sync server is stopped')
    }
    return repo.find<RootDocument>(docUrl as AutomergeUrl, {
      signal: AbortSignal.timeout(findTimeoutMs),
    })
  }

  const published = ({ sessionId, openedAt }: OpenSession) => ({
    sessionId,
    startedAt: new Date(openedAt).toISOString(),
  })

  return {
    async start(docUrl) {
      const open = sessions.current()
      if (open) {
        throw new Error(`Session ${open.sessionId} is already open`)
      }
      // Found before opening, so a doc the host cannot reach opens nothing.
      const handle = await findRoot(docUrl)
      // Throws if another start opened a session while this one waited.
      const session = published(
        sessions.open({ sessionId: newSessionId(), docUrl }),
      )
      publishedIn = { sessionId: session.sessionId, docUrl }
      handle.change((doc) => {
        doc.session = session
      })
      return session
    },

    async stop() {
      const open = sessions.current()
      if (!open) {
        return
      }
      const target = publishedIn
      publishedIn = undefined
      // `close` ends the session at once and resolves only after signing.
      void sessions.close()
      if (!target || target.sessionId !== open.sessionId) {
        return
      }
      try {
        const handle = await findRoot(target.docUrl)
        handle.change((doc) => {
          if (doc.session?.sessionId === target.sessionId) {
            delete doc.session
          }
        })
      } catch (error) {
        // The session is closed either way. The next start clears the field.
        console.error(
          `Could not clear session ${target.sessionId} from the doc:`,
          error,
        )
      }
    },

    current() {
      const open = sessions.current()
      return open ? published(open) : undefined
    },

    async clearStale(docUrl) {
      const handle = await findRoot(docUrl)
      const stale = handle.doc()?.session
      if (!stale || stale.sessionId === sessions.current()?.sessionId) {
        return
      }
      handle.change((doc) => {
        delete doc.session
      })
    },
  }
}
