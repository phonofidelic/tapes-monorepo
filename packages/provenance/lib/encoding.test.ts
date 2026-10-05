import { describe, expect, it } from 'vitest'
import { fromBase64Url, sha256Hex, toBase64Url } from './encoding'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('base64url', () => {
  it.each([
    [bytes(), ''],
    [bytes(0xfb), '-w'],
    [bytes(0xfb, 0xff), '-_8'],
    [bytes(0xfb, 0xff, 0xbf), '-_-_'],
    [bytes(0x66, 0x6f, 0x6f, 0x62), 'Zm9vYg'],
  ])('round-trips %s as %s', (value, text) => {
    expect(toBase64Url(value)).toBe(text)
    expect(fromBase64Url(text)).toEqual(value)
  })

  it.each([
    ['padding', 'Zg=='],
    ['standard base64 characters', '+/8'],
    ['an impossible length', 'Zm9vY'],
    ['stray trailing bits', 'Zh'],
  ])('rejects %s', (_, text) => {
    expect(fromBase64Url(text)).toBeUndefined()
  })
})

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
