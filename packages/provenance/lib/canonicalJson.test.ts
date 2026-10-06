import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonicalJson'

describe('canonicalJson', () => {
  it('sorts keys and drops whitespace', () => {
    expect(canonicalJson({ b: [1, { d: true, c: null }], a: 'x' })).toBe(
      '{"a":"x","b":[1,{"c":null,"d":true}]}',
    )
  })

  // RFC 8785 section 3.2.3: keys sort by UTF-16 code unit, so the emoji's
  // high surrogate sorts before U+FB33.
  it('sorts keys by UTF-16 code unit', () => {
    const keys = [
      '\u20ac',
      '\r',
      '\ufb33',
      '1',
      '\ud83d\ude00',
      '\u0080',
      '\u00f6',
    ]
    const value = Object.fromEntries(keys.map((key) => [key, 0]))

    expect(canonicalJson(value)).toBe(
      '{"\\r":0,"1":0,"\u0080":0,"\u00f6":0,"\u20ac":0,"\ud83d\ude00":0,"\ufb33":0}',
    )
  })

  // RFC 8785 appendix B.
  it.each([
    [0, '0'],
    [-0, '0'],
    [1e21, '1e+21'],
    [1e-7, '1e-7'],
    [0.000001, '0.000001'],
    [4.5, '4.5'],
    [2e-3, '0.002'],
    [Number('333333333.33333329'), '333333333.3333333'],
    [9007199254740992, '9007199254740992'],
    [295147905179352830000, '295147905179352830000'],
  ])('writes %d as %s', (value, expected) => {
    expect(canonicalJson(value)).toBe(expected)
  })

  it('escapes only what JSON requires', () => {
    expect(canonicalJson('a/b\u20ac\n\u001f"\\')).toBe(
      '"a/b€\\n\\u001f\\"\\\\"',
    )
  })

  it('treats an undefined field as missing', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
  })

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a lone surrogate', '\ud83d'],
    ['a lone surrogate key', { '\ude00': 1 }],
    ['undefined in an array', [undefined]],
    ['a Date', new Date(0)],
    ['a bigint', BigInt(1)],
    ['a function', () => 1],
  ])('rejects %s', (_, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError)
  })
})
