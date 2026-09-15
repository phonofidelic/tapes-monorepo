import { describe, expect, it } from 'vitest'
import {
  readDeviceLabel,
  sanitizeDeviceLabel,
  MAX_DEVICE_LABEL_LENGTH,
} from './deviceLabel'

function upgradeRequest(headers: Record<string, string | string[]> = {}) {
  return { headers }
}

describe('sanitizeDeviceLabel', () => {
  it('keeps ordinary text as it is', () => {
    expect(sanitizeDeviceLabel('Studio iPad')).toBe('Studio iPad')
  })

  it('caps the length', () => {
    expect(
      sanitizeDeviceLabel('a'.repeat(MAX_DEVICE_LABEL_LENGTH + 20)),
    ).toHaveLength(MAX_DEVICE_LABEL_LENGTH)
  })

  // A guest chooses this string, and it reaches a log line and the UI. Built
  // from char codes so the characters under test stay visible in the source.
  it('strips control characters and collapses whitespace', () => {
    const nul = String.fromCharCode(0x00)
    const lineSeparator = String.fromCharCode(0x2028)
    const rightToLeftOverride = String.fromCharCode(0x202e)

    expect(sanitizeDeviceLabel(`phone\n\nSync guest connected: host`)).toBe(
      'phone Sync guest connected: host',
    )
    expect(sanitizeDeviceLabel(`a${nul}b${lineSeparator}c`)).toBe('a b c')
    expect(sanitizeDeviceLabel(`iPad${rightToLeftOverride}gpj.x`)).toBe(
      'iPad gpj.x',
    )
  })

  it('is undefined when nothing printable is left', () => {
    expect(sanitizeDeviceLabel('  \n ')).toBeUndefined()
    expect(sanitizeDeviceLabel('')).toBeUndefined()
    expect(sanitizeDeviceLabel(undefined)).toBeUndefined()
    expect(sanitizeDeviceLabel(['a label'])).toBeUndefined()
  })
})

describe('readDeviceLabel', () => {
  it('reads the `d` query parameter a browser guest sends', () => {
    const url = new URL('http://host/sync?t=secret&d=Studio%20iPad')

    expect(readDeviceLabel(upgradeRequest(), url)).toBe('Studio iPad')
  })

  it('accepts a header from a client that can set one', () => {
    expect(
      readDeviceLabel(
        upgradeRequest({ 'x-tapes-device-label': 'Desk Mac' }),
        new URL('http://host/sync'),
      ),
    ).toBe('Desk Mac')
  })

  // The query is the only form a browser has, so it wins over the header.
  it('prefers the query parameter over the header', () => {
    expect(
      readDeviceLabel(
        upgradeRequest({ 'x-tapes-device-label': 'Desk Mac' }),
        new URL('http://host/sync?d=Studio%20iPad'),
      ),
    ).toBe('Studio iPad')
  })

  it('sanitizes what the guest sent', () => {
    const url = new URL(
      `http://host/sync?d=${encodeURIComponent('a'.repeat(200))}`,
    )

    expect(readDeviceLabel(upgradeRequest(), url)).toHaveLength(
      MAX_DEVICE_LABEL_LENGTH,
    )
  })

  it('is undefined when the guest sent nothing usable', () => {
    expect(
      readDeviceLabel(upgradeRequest(), new URL('http://host/sync?t=secret')),
    ).toBeUndefined()
    expect(
      readDeviceLabel(upgradeRequest(), new URL('http://host/sync?d=%20')),
    ).toBeUndefined()
  })
})
