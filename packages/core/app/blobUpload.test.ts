import { describe, expect, it } from 'vitest'
import {
  addPendingUpload,
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
