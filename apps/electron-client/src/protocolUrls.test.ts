import { describe, expect, it } from 'vitest'
import { filepathFromTapesUrl, hashFromTapesBlobUrl } from './protocolUrls'

const HASH = 'a'.repeat(64)

describe('filepathFromTapesUrl', () => {
  it('reads back an absolute path', () => {
    expect(filepathFromTapesUrl('tapes:///Users/chris/take-one.wav')).toBe(
      '/Users/chris/take-one.wav',
    )
  })

  it('decodes a path with spaces and other escaped characters', () => {
    expect(
      filepathFromTapesUrl('tapes:///Users/chris/My%20Tapes/take%231.wav'),
    ).toBe('/Users/chris/My Tapes/take#1.wav')
  })

  it('encodes such a path on the way in, so the round trip holds', () => {
    const filepath = '/Users/chris/My Tapes/take one.wav'
    expect(filepathFromTapesUrl(`tapes://${filepath}`)).toBe(filepath)
  })

  it('reads a path that arrived as an authority instead', () => {
    // Not a shape the app produces — recordings carry absolute paths — but the
    // scheme is non-standard precisely so an absolute path keeps its leading
    // slash, and this pins what happens either way.
    expect(filepathFromTapesUrl('tapes://take-one.wav/')).toBe('take-one.wav')
  })

  it('leaves a malformed escape alone rather than throwing', () => {
    expect(filepathFromTapesUrl('tapes:///Users/chris/100%.wav')).toBe(
      '/Users/chris/100%.wav',
    )
  })
})

describe('hashFromTapesBlobUrl', () => {
  it('reads the hash out of the authority', () => {
    expect(hashFromTapesBlobUrl(`tapes-blob://${HASH}`)).toBe(HASH)
  })

  it('reads it back once normalisation has added a trailing slash', () => {
    expect(hashFromTapesBlobUrl(`tapes-blob://${HASH}/`)).toBe(HASH)
  })
})
