/**
 * The guest half of the passkey ceremony. It opens the page on
 * `identity.tapes.network` in a new tab and waits for its answer.
 *
 * A guest is served from the host's LAN IP, which WebAuthn refuses as a
 * relying party id, so the passkey runs at that origin instead. It has to be a
 * tab rather than an iframe: Safari has no cross-origin passkey creation, and
 * every iOS browser is WebKit. Keep the message shapes in step with
 * `apps/identity/public/ceremony.v1.js`, which cannot import them.
 */

import { fromBase64Url } from '@tapes-monorepo/provenance'

/** Where the ceremony page is served. */
export const CEREMONY_ORIGIN = 'https://identity.tapes.network'

/** Both sides check this before reading any other field. */
export const CEREMONY_PROTOCOL = 'tapes-person-key-ceremony'
export const CEREMONY_PROTOCOL_VERSION = 1

/** Long enough to find a phone, read the page and pass a face or fingerprint. */
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000

/** How often the tab is checked for having been closed. */
const CLOSED_POLL_MS = 500

export type CeremonyAction = 'create' | 'get'

export type CeremonyRequest = {
  /** `create` makes a passkey. `get` unlocks with one that exists. */
  action: CeremonyAction
  /** The host's own name for itself. The page shows it as a claim. */
  hostName: string
  /** What the passkey is listed under in a password manager. */
  personName?: string
  /** The person public key, base64url, so one person has one passkey. */
  userId?: string
  /** Narrows a `get` to known passkeys. Empty means any Tapes passkey. */
  credentialIds?: string[]
}

/**
 * Why a ceremony produced no PRF output. `no-prf` is the one a person has to
 * act on: that password manager cannot hold a Tapes key, and the passphrase
 * backup is the way through.
 */
export type CeremonyProblem =
  | 'blocked'
  | 'closed'
  | 'timeout'
  | 'declined'
  | 'unsupported'
  | 'no-prf'
  | 'failed'

export type CeremonyOutcome =
  | {
      ok: true
      credentialId: string
      rpId: string
      /** The 32 bytes the passkey derived. Never stored as it is. */
      prf: Uint8Array<ArrayBuffer>
    }
  | { ok: false; problem: CeremonyProblem }

export type CeremonyOptions = {
  origin?: string
  timeoutMs?: number
  /** Replaced in tests. The real one must run inside the tap. */
  open?: (url: string) => Window | null
}

type CeremonyMessage = {
  tapes?: unknown
  version?: unknown
  type?: unknown
  nonce?: unknown
  rpId?: unknown
  credentialId?: unknown
  prf?: unknown
  reason?: unknown
}

const problems: CeremonyProblem[] = [
  'declined',
  'unsupported',
  'no-prf',
  'failed',
]

/**
 * Runs one ceremony. Call it from the tap itself: a browser only opens a tab
 * for a gesture, and an await before the call loses that gesture.
 */
export function runPasskeyCeremony(
  request: CeremonyRequest,
  options: CeremonyOptions = {},
): Promise<CeremonyOutcome> {
  const origin = options.origin ?? CEREMONY_ORIGIN
  // No `noopener` or `noreferrer` here. Either one severs `window.opener`, and
  // the page would have nothing to answer.
  const open = options.open ?? ((url: string) => window.open(url, '_blank'))
  const nonce = crypto.randomUUID()
  // The page needs this origin to address its first message, and a fragment
  // never reaches the server.
  const url = `${origin}/#o=${encodeURIComponent(window.location.origin)}`
  const tab = open(url)
  if (!tab) {
    return Promise.resolve({ ok: false, problem: 'blocked' })
  }

  return new Promise((resolve) => {
    let settled = false

    const finish = (outcome: CeremonyOutcome) => {
      if (settled) {
        return
      }
      settled = true
      window.removeEventListener('message', received)
      clearInterval(poll)
      clearTimeout(timer)
      resolve(outcome)
    }

    function received(event: MessageEvent) {
      if (event.origin !== origin || event.source !== tab) {
        return
      }
      const data: CeremonyMessage =
        typeof event.data === 'object' && event.data !== null ? event.data : {}
      if (
        data.tapes !== CEREMONY_PROTOCOL ||
        data.version !== CEREMONY_PROTOCOL_VERSION
      ) {
        return
      }
      if (data.type === 'ready') {
        tab?.postMessage(
          {
            tapes: CEREMONY_PROTOCOL,
            version: CEREMONY_PROTOCOL_VERSION,
            type: 'request',
            nonce,
            ...request,
          },
          origin,
        )
        return
      }
      // A reply to some other ceremony, or to none, is not this one's answer.
      if (data.nonce !== nonce) {
        return
      }
      if (data.type === 'result') {
        finish(result(data))
        return
      }
      if (data.type === 'error') {
        const reason = problems.find((problem) => problem === data.reason)
        finish({ ok: false, problem: reason ?? 'failed' })
      }
    }

    window.addEventListener('message', received)
    // A person who closes the tab has answered, and the caller should not wait
    // out the timeout to hear it.
    const poll = setInterval(() => {
      if (tab.closed) {
        finish({ ok: false, problem: 'closed' })
      }
    }, CLOSED_POLL_MS)
    const timer = setTimeout(() => {
      tab.close()
      finish({ ok: false, problem: 'timeout' })
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  })
}

/** A malformed result is a failure, not a key. */
function result(data: CeremonyMessage): CeremonyOutcome {
  const prf = typeof data.prf === 'string' ? fromBase64Url(data.prf) : undefined
  if (
    typeof data.credentialId !== 'string' ||
    typeof data.rpId !== 'string' ||
    !prf ||
    prf.length !== 32
  ) {
    return { ok: false, problem: 'failed' }
  }
  return {
    ok: true,
    credentialId: data.credentialId,
    rpId: data.rpId,
    prf,
  }
}
