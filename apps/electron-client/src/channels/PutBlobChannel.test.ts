import { createHash } from 'crypto'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRecordingClaim,
  decodeSignedStatement,
  encodeSignedStatement,
  generateSigningKeyPair,
  verifyStatement,
} from '@tapes-monorepo/provenance'
import { createBlobStore, type BlobStore } from '@/blobStore'
import { PutBlobChannel } from './PutBlobChannel'

vi.mock('electron', () => ({ app: {}, safeStorage: {} }))

let store: BlobStore | undefined
vi.mock('@/syncServer', () => ({ getBlobStore: () => store }))

const AUDIO = 'recorded audio'
const DOC = 'automerge:doc-a'

function recordedFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tapes-put-'))
  const filepath = path.join(dir, 'take-one.wav')
  writeFileSync(filepath, AUDIO)
  return filepath
}

async function claimOver(bytes: string, keyPair: CryptoKeyPair) {
  return encodeSignedStatement(
    await createRecordingClaim(
      {
        blob: {
          hash: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.length,
          mimeType: 'audio/wav',
        },
        startedAt: '2026-10-05T12:00:00.000Z',
        endedAt: '2026-10-05T12:03:00.000Z',
      },
      keyPair,
    ),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PutBlobChannel', () => {
  it('receipts the claim the host signed when it stopped recording', async () => {
    store = createBlobStore(mkdtempSync(path.join(tmpdir(), 'tapes-blobs-')))
    const hostKey = await generateSigningKeyPair()
    const channel = new PutBlobChannel(async () => hostKey)

    const response = await channel.handle({
      data: {
        filepath: recordedFile(),
        docUrl: DOC,
        claim: await claimOver(AUDIO, hostKey),
      },
    })

    if (!response.success || response.data.claim.status !== 'verified') {
      throw new Error(
        `Expected a verified claim, got ${JSON.stringify(response)}`,
      )
    }
    const receipt = decodeSignedStatement(response.data.claim.receipt!)!
    expect(await verifyStatement(receipt, hostKey.publicKey)).toBe(true)
  })

  it('stores the file when its claim does not match', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    store = createBlobStore(mkdtempSync(path.join(tmpdir(), 'tapes-blobs-')))
    const hostKey = await generateSigningKeyPair()
    const channel = new PutBlobChannel(async () => hostKey)

    const response = await channel.handle({
      data: {
        filepath: recordedFile(),
        docUrl: DOC,
        claim: await claimOver('other audio', hostKey),
      },
    })

    expect(response).toMatchObject({
      success: true,
      data: {
        hash: createHash('sha256').update(AUDIO).digest('hex'),
        claim: { status: 'unverified', problem: 'hash-mismatch' },
      },
    })
  })

  it('reports a file with no claim as unsigned', async () => {
    store = createBlobStore(mkdtempSync(path.join(tmpdir(), 'tapes-blobs-')))
    const channel = new PutBlobChannel(generateSigningKeyPair)

    const response = await channel.handle({
      data: { filepath: recordedFile(), docUrl: DOC },
    })

    expect(response).toMatchObject({
      success: true,
      data: { claim: { status: 'unsigned' } },
    })
  })
})
