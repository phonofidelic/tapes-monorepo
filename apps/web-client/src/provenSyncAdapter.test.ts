import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import type { PeerId } from '@automerge/automerge-repo'
import {
  checkSyncProof,
  decodeSignedStatement,
  exportPublicKey,
  generateSigningKeyPair,
} from '@tapes-monorepo/provenance'
import { SYNC_PROOF_PARAM } from '@tapes-monorepo/sync-protocol'
import { ProvenSyncAdapter } from './provenSyncAdapter'

const SYNC_URL = 'wss://192.168.1.5:9001/sync?t=secret&d=Phone'
const PEER = 'guest' as PeerId

/** Records the url each connect used, without opening a socket. */
function captureConnects() {
  const urls: string[] = []
  vi.spyOn(
    BrowserWebSocketClientAdapter.prototype,
    'connect',
  ).mockImplementation(function (this: BrowserWebSocketClientAdapter) {
    urls.push(this.url)
  })
  return urls
}

function challengeServer() {
  let issued = 0
  const fetchImpl = vi.fn(async () =>
    Response.json({ challenge: `challenge-${++issued}` }),
  )
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl }
}

async function proofIn(url: string) {
  const encoded = new URL(url).searchParams.get(SYNC_PROOF_PARAM)
  return decodeSignedStatement(encoded!)!
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProvenSyncAdapter', () => {
  it('connects with a proof over a fresh challenge each time', async () => {
    const urls = captureConnects()
    const keyPair = await generateSigningKeyPair()
    const { fetchImpl, calls } = challengeServer()
    const adapter = new ProvenSyncAdapter(
      SYNC_URL,
      async () => keyPair,
      fetchImpl,
    )

    adapter.connect(PEER)
    await vi.waitFor(() => expect(urls).toHaveLength(1))
    adapter.connect(PEER)
    await vi.waitFor(() => expect(urls).toHaveLength(2))

    expect(calls).toHaveBeenCalledWith(
      'https://192.168.1.5:9001/challenge',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret' },
      }),
    )
    const deviceKey = await exportPublicKey(keyPair.publicKey)
    expect(await checkSyncProof(await proofIn(urls[0]), 'challenge-1')).toBe(
      deviceKey,
    )
    expect(await checkSyncProof(await proofIn(urls[1]), 'challenge-2')).toBe(
      deviceKey,
    )
    // The rest of the url is untouched.
    expect(new URL(urls[1]).searchParams.get('d')).toBe('Phone')
  })

  it('does not start a second connect while a proof is being made', async () => {
    const urls = captureConnects()
    const { fetchImpl, calls } = challengeServer()
    const adapter = new ProvenSyncAdapter(
      SYNC_URL,
      generateSigningKeyPair,
      fetchImpl,
    )

    adapter.connect(PEER)
    adapter.connect(PEER)
    await vi.waitFor(() => expect(urls).toHaveLength(1))

    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('connects without a proof when the challenge fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const urls = captureConnects()
    const adapter = new ProvenSyncAdapter(
      SYNC_URL,
      generateSigningKeyPair,
      async () => new Response(null, { status: 404 }),
    )

    adapter.connect(PEER)
    await vi.waitFor(() => expect(urls).toHaveLength(1))

    expect(urls[0]).toBe(SYNC_URL)
  })

  it('does not ask a server it holds no pairing token for', async () => {
    const urls = captureConnects()
    const { fetchImpl, calls } = challengeServer()
    const adapter = new ProvenSyncAdapter(
      'wss://sync.example.com/sync',
      generateSigningKeyPair,
      fetchImpl,
    )

    adapter.connect(PEER)
    await vi.waitFor(() => expect(urls).toHaveLength(1))

    expect(calls).not.toHaveBeenCalled()
  })

  it('does not connect after a disconnect during the proof', async () => {
    const urls = captureConnects()
    const { fetchImpl } = challengeServer()
    const adapter = new ProvenSyncAdapter(
      SYNC_URL,
      generateSigningKeyPair,
      fetchImpl,
    )

    adapter.connect(PEER)
    adapter.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(urls).toEqual([])
  })

  it('is connected only while the host has answered on the socket', () => {
    const adapter = new ProvenSyncAdapter(SYNC_URL, generateSigningKeyPair)
    const host = 'host' as PeerId

    expect(adapter.isConnected()).toBe(false)
    adapter.emit('peer-candidate', { peerId: host, peerMetadata: {} })
    expect(adapter.isConnected()).toBe(true)
    adapter.emit('peer-disconnected', { peerId: host })
    expect(adapter.isConnected()).toBe(false)
  })
})
