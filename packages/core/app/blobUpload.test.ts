import { describe, expect, it, vi } from 'vitest'
import type { IpcService } from './IpcService'
import {
  addPendingUpload,
  ingestHostFile,
  readPendingUploads,
  recordingMimeType,
  removePendingUpload,
} from './blobUpload'

const memoryStorage = (): Storage => {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: (index) => [...items.keys()][index] ?? null,
    get length() {
      return items.size
    },
  }
}

describe('pending uploads', () => {
  // The claim is signed at stop and cannot be made again, so a retry after
  // the device comes back online must still have it.
  it('keeps the signed claim with a queued upload', () => {
    const storage = memoryStorage()
    addPendingUpload(storage, {
      docUrl: 'automerge:a',
      filepath: 'a.webm',
      claim: 'encoded-claim',
    })

    expect(readPendingUploads(storage)).toEqual([
      { docUrl: 'automerge:a', filepath: 'a.webm', claim: 'encoded-claim' },
    ])

    removePendingUpload(storage, 'automerge:a')
    expect(readPendingUploads(storage)).toEqual([])
  })
})

describe('recordingMimeType', () => {
  it('names the audio format, or mp4 when there is none', () => {
    expect(recordingMimeType('webm')).toBe('audio/webm')
    expect(recordingMimeType(undefined)).toBe('audio/mp4')
  })
})

describe('ingestHostFile', () => {
  // The descriptor and statement hashes are written into the shared doc.
  // The host's verdict on the claim is not.
  it('returns the blob descriptor and statements, not the verdict', async () => {
    const send = vi.fn().mockResolvedValue({
      success: true,
      data: {
        hash: 'ab'.repeat(32),
        size: 4,
        mimeType: 'audio/wav',
        ext: '.wav',
        claim: { status: 'verified', receipt: 'receipt' },
        statements: ['cd'.repeat(32)],
      },
    })

    const descriptor = await ingestHostFile({ send } as unknown as IpcService, {
      filepath: '/take.wav',
      docUrl: 'automerge:a',
      claim: 'claim',
    })

    expect(descriptor).toEqual({
      blob: {
        hash: 'ab'.repeat(32),
        size: 4,
        mimeType: 'audio/wav',
        ext: '.wav',
      },
      statements: ['cd'.repeat(32)],
    })
  })
})
