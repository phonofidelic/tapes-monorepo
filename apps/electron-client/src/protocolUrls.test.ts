import { describe, expect, it } from 'vitest'
import { hashFromTapesBlobUrl } from './protocolUrls'

const HASH = 'a'.repeat(64)

describe('hashFromTapesBlobUrl', () => {
  it('reads the hash out of the authority', () => {
    expect(hashFromTapesBlobUrl(`tapes-blob://${HASH}`)).toBe(HASH)
  })

  it('reads it back once normalisation has added a trailing slash', () => {
    expect(hashFromTapesBlobUrl(`tapes-blob://${HASH}/`)).toBe(HASH)
  })
})
