import { describe, expect, it } from 'vitest'
import { formatSessionClock, shortSessionId } from './sessionFormat'

describe('shortSessionId', () => {
  it('shows the first eight hex characters as two groups', () => {
    expect(shortSessionId('7c41e2b0-1111-4222-8333-444455556666')).toBe(
      '7c41·e2b0',
    )
  })

  it('skips the dashes in a UUID', () => {
    expect(shortSessionId('7C41-E2B0-ffff')).toBe('7c41·e2b0')
  })
})

describe('formatSessionClock', () => {
  it.each([
    [0, '0:00'],
    [9_999, '0:09'],
    [42 * 60_000 + 10_000, '42:10'],
    [3_600_000 + 5 * 60_000 + 7_000, '1:05:07'],
    [-5_000, '0:00'],
  ])('writes %i ms as %s', (ms, expected) => {
    expect(formatSessionClock(ms)).toBe(expected)
  })
})
