import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import type { PeerId, PeerMetadata } from '@automerge/automerge-repo'
import {
  createSyncProof,
  encodeSignedStatement,
} from '@tapes-monorepo/provenance'
import {
  syncChallengeUrl,
  withSyncProof,
  type SyncChallengeResponse,
} from '@tapes-monorepo/sync-protocol'

/**
 * The sync socket adapter, with a proof that this device holds its signing
 * key added to the url before each connect. The host then lists the
 * connection under that key in its session records.
 *
 * The base adapter reconnects on the same url, and a proof works once. So a
 * fresh challenge is fetched and signed on every connect, including retries.
 * Any failure connects without a proof. The host still serves the socket.
 */

/** Long enough for a slow LAN, short enough not to hold up a reconnect. */
const CHALLENGE_TIMEOUT_MS = 5_000

export class ProvenSyncAdapter extends BrowserWebSocketClientAdapter {
  // Rewritten before each connect, which the base class reads it on.
  declare url: string
  private proving = false
  private stopped = false

  constructor(
    private readonly baseUrl: string,
    private readonly loadKey: () => Promise<CryptoKeyPair>,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    super(baseUrl)
  }

  override connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    // The base class retries on a timer. A retry while a proof is still being
    // made would open a second socket.
    if (this.proving) {
      return
    }
    this.proving = true
    void this.provenUrl().then((url) => {
      this.proving = false
      if (this.stopped) {
        return
      }
      this.url = url
      super.connect(peerId, peerMetadata)
    })
  }

  override disconnect(): void {
    this.stopped = true
    // Nothing to close if the first proof never finished.
    if (this.socket) {
      super.disconnect()
    }
  }

  private async provenUrl(): Promise<string> {
    // Only a host that handed out a pairing token issues challenges.
    const token = new URL(this.baseUrl).searchParams.get('t')
    if (!token) {
      return this.baseUrl
    }
    try {
      const response = await this.fetchImpl(syncChallengeUrl(this.baseUrl), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(CHALLENGE_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`Challenge request failed: ${response.status}`)
      }
      const { challenge } = (await response.json()) as SyncChallengeResponse
      const proof = await createSyncProof(challenge, await this.loadKey())
      return withSyncProof(this.baseUrl, encodeSignedStatement(proof))
    } catch (error) {
      console.warn('Connecting without a device key proof:', error)
      return this.baseUrl
    }
  }
}
