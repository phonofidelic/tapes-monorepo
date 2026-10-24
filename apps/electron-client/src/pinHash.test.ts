import { describe, expect, it } from 'vitest'
import { hashPin, pinMatches } from './pinHash'

// Few iterations keep the suite fast. The count is stored with the hash.
const ITERATIONS = 1_000

describe('hashPin', () => {
  it('matches the PIN it was made from and no other', async () => {
    const stored = await hashPin('4821', ITERATIONS)

    expect(await pinMatches('4821', stored)).toBe(true)
    expect(await pinMatches('4822', stored)).toBe(false)
  })

  it('salts each hash, so one PIN hashes two ways', async () => {
    const a = await hashPin('4821', ITERATIONS)
    const b = await hashPin('4821', ITERATIONS)

    expect(a.hash).not.toBe(b.hash)
  })

  it('never matches something that is not a PIN', async () => {
    const stored = await hashPin('4821', ITERATIONS)

    expect(await pinMatches(' 4821', stored)).toBe(false)
  })
})
