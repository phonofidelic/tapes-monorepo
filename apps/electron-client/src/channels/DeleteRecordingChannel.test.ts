import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { Readable } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import { createBlobStore, type BlobStore } from '@/blobStore'
import { DeleteRecordingChannel } from './DeleteRecordingChannel'

vi.mock('electron', () => ({ app: {}, safeStorage: {} }))

let store: BlobStore | undefined
vi.mock('@/syncServer', () => ({ getBlobStore: () => store }))

const DOC = 'automerge:doc-a'

async function put(contents: string, mimeType: string) {
  const { meta } = await store!.ingestStream(Readable.from([contents]), {
    mimeType,
    docUrl: DOC,
  })
  return meta.hash
}

describe('DeleteRecordingChannel', () => {
  it('releases the statements along with the audio', async () => {
    store = createBlobStore(mkdtempSync(path.join(tmpdir(), 'tapes-blobs-')))
    const audio = await put('recorded audio', 'audio/wav')
    const claim = await put('{"claim":1}', 'application/json')
    const receipt = await put('{"receipt":1}', 'application/json')

    const response = await new DeleteRecordingChannel().handle({
      data: { hash: audio, statements: [claim, receipt], docUrl: DOC },
    })

    expect(response).toEqual({ success: true })
    expect(await store.has(audio)).toBe(false)
    expect(await store.has(claim)).toBe(false)
    expect(await store.has(receipt)).toBe(false)
  })

  it('rejects a statements list that is not hashes', async () => {
    await expect(
      new DeleteRecordingChannel().handle({
        data: {
          hash: 'a'.repeat(64),
          statements: ['../../outside'],
          docUrl: DOC,
        },
      }),
    ).rejects.toThrow('Invalid data')
  })
})
