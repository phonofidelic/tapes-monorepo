import { describe, expect, it } from 'vitest'
import {
  deriveDeviceLabel,
  readStoredDeviceLabel,
  resolveDeviceLabel,
  withDeviceLabel,
  FALLBACK_DEVICE_LABEL,
} from './deviceLabel'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const ANDROID_FIREFOX =
  'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0'

function storageWith(settings?: string): Pick<Storage, 'getItem'> {
  return { getItem: (key) => (key === 'settings' ? (settings ?? null) : null) }
}

describe('deriveDeviceLabel', () => {
  it('names the device and the browser', () => {
    expect(deriveDeviceLabel({ userAgent: IPHONE_SAFARI })).toBe(
      'iPhone · Safari',
    )
    expect(
      deriveDeviceLabel({ userAgent: MAC_CHROME, platform: 'MacIntel' }),
    ).toBe('Mac · Chrome')
    expect(deriveDeviceLabel({ userAgent: ANDROID_FIREFOX })).toBe(
      'Android · Firefox',
    )
  })

  // An iPad asking for the desktop site is indistinguishable from a Mac except
  // for the touchscreen.
  it('reads a touch-capable Mac user agent as an iPad', () => {
    expect(
      deriveDeviceLabel({
        userAgent: MAC_CHROME,
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe('iPad · Chrome')
  })

  it('falls back when it can tell nothing', () => {
    expect(deriveDeviceLabel({ userAgent: 'something/1.0' })).toBe(
      FALLBACK_DEVICE_LABEL,
    )
    expect(deriveDeviceLabel(undefined)).toBe(FALLBACK_DEVICE_LABEL)
  })
})

describe('readStoredDeviceLabel', () => {
  it('reads the override out of the settings blob', () => {
    expect(
      readStoredDeviceLabel(
        storageWith(JSON.stringify({ deviceLabel: 'Studio iPad' })),
      ),
    ).toBe('Studio iPad')
  })

  it('sanitizes what it reads', () => {
    expect(
      readStoredDeviceLabel(
        storageWith(JSON.stringify({ deviceLabel: 'two\nlines' })),
      ),
    ).toBe('two lines')
  })

  it('is undefined for anything unusable', () => {
    expect(readStoredDeviceLabel(storageWith('not json'))).toBeUndefined()
    expect(readStoredDeviceLabel(storageWith('[]'))).toBeUndefined()
    expect(readStoredDeviceLabel(storageWith())).toBeUndefined()
    expect(
      readStoredDeviceLabel(storageWith(JSON.stringify({ deviceLabel: 7 }))),
    ).toBeUndefined()
  })
})

describe('resolveDeviceLabel', () => {
  it('prefers the user override over the derived name', () => {
    expect(
      resolveDeviceLabel({
        storage: storageWith(JSON.stringify({ deviceLabel: 'Studio iPad' })),
        navigator: { userAgent: IPHONE_SAFARI },
      }),
    ).toBe('Studio iPad')
  })

  it('derives a name when nothing is stored', () => {
    expect(
      resolveDeviceLabel({
        storage: storageWith(),
        navigator: { userAgent: IPHONE_SAFARI },
      }),
    ).toBe('iPhone · Safari')
  })

  it('always resolves to something', () => {
    expect(resolveDeviceLabel({})).toBe(FALLBACK_DEVICE_LABEL)
  })
})

describe('withDeviceLabel', () => {
  it('adds the label as the `d` parameter, alongside the token', () => {
    expect(withDeviceLabel('ws://host:9001/sync?t=secret', 'Studio iPad')).toBe(
      'ws://host:9001/sync?t=secret&d=Studio+iPad',
    )
  })

  it('leaves the url alone when there is no usable label', () => {
    expect(withDeviceLabel('ws://host:9001/sync')).toBe('ws://host:9001/sync')
    expect(withDeviceLabel('ws://host:9001/sync', '  ')).toBe(
      'ws://host:9001/sync',
    )
  })

  it('replaces a label already on the url rather than repeating it', () => {
    expect(withDeviceLabel('ws://host/sync?d=Old', 'New')).toBe(
      'ws://host/sync?d=New',
    )
  })
})
