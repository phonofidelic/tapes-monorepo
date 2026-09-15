import { describe, expect, it } from 'vitest'
import { hasHostClientMarker, withHostClientMarker } from './hostClient'

describe('withHostClientMarker', () => {
  it('marks a url', () => {
    expect(withHostClientMarker('ws://127.0.0.1:9001/?t=secret')).toBe(
      'ws://127.0.0.1:9001/?t=secret&h=1',
    )
  })

  it('does not mark a url twice', () => {
    expect(
      withHostClientMarker(withHostClientMarker('ws://127.0.0.1:9001')),
    ).toBe('ws://127.0.0.1:9001/?h=1')
  })
})

describe('hasHostClientMarker', () => {
  it('reads the mark', () => {
    expect(hasHostClientMarker(new URL('ws://127.0.0.1:9001/?h=1'))).toBe(true)
  })

  it('is false without it', () => {
    expect(hasHostClientMarker(new URL('ws://127.0.0.1:9001/?d=Phone'))).toBe(
      false,
    )
  })

  // Only the one value counts, so a guest sending `?h=whatever` is not read as
  // a host claim.
  it('is false for any other value', () => {
    expect(hasHostClientMarker(new URL('ws://127.0.0.1:9001/?h=yes'))).toBe(
      false,
    )
  })
})
