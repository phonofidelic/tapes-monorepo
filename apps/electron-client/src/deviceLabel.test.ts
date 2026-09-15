import { describe, expect, it } from 'vitest'
import { MAX_DEVICE_LABEL_LENGTH } from '@tapes-monorepo/sync-protocol'
import { readDeviceLabel } from './deviceLabel'

function upgradeRequest(headers: Record<string, string | string[]> = {}) {
  return { headers }
}

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
