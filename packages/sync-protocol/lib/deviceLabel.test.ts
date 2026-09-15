import { describe, expect, it } from 'vitest'
import { sanitizeDeviceLabel, MAX_DEVICE_LABEL_LENGTH } from './deviceLabel'

describe('sanitizeDeviceLabel', () => {
  it('keeps ordinary text as it is', () => {
    expect(sanitizeDeviceLabel('Studio iPad')).toBe('Studio iPad')
  })

  it('caps the length', () => {
    const long = 'a'.repeat(MAX_DEVICE_LABEL_LENGTH + 20)

    expect(sanitizeDeviceLabel(long)).toHaveLength(MAX_DEVICE_LABEL_LENGTH)
  })

  // The name is attacker-controlled and reaches a log line and the UI. It must
  // not be able to forge either. Built from char codes so the characters under
  // test stay visible in the source.
  it('strips control characters and collapses whitespace', () => {
    const nul = String.fromCharCode(0x00)
    const lineSeparator = String.fromCharCode(0x2028)
    const c1Control = String.fromCharCode(0x9f)
    const rightToLeftOverride = String.fromCharCode(0x202e)

    expect(sanitizeDeviceLabel(`phone\n\ninfo: forged${nul} line`)).toBe(
      'phone info: forged line',
    )
    expect(sanitizeDeviceLabel(`a${lineSeparator}b${c1Control}c`)).toBe('a b c')
    expect(sanitizeDeviceLabel(`iPad${rightToLeftOverride}gpj.x`)).toBe(
      'iPad gpj.x',
    )
  })

  it('is undefined when nothing printable is left', () => {
    expect(sanitizeDeviceLabel('   \n\t ')).toBeUndefined()
    expect(sanitizeDeviceLabel('')).toBeUndefined()
    expect(sanitizeDeviceLabel(undefined)).toBeUndefined()
    expect(sanitizeDeviceLabel(42)).toBeUndefined()
  })

  it('does not leave half a surrogate pair at the cut', () => {
    // Fills the cap exactly but for one code unit, then an emoji whose second
    // half falls past it.
    const emoji = String.fromCodePoint(0x1f600)
    const label = `${'a'.repeat(MAX_DEVICE_LABEL_LENGTH - 1)}${emoji}`

    expect(sanitizeDeviceLabel(label)).toBe(
      'a'.repeat(MAX_DEVICE_LABEL_LENGTH - 1),
    )
  })
})
