import { describe, expect, it } from 'vitest'
import {
  buildGuestUrl,
  decodeFingerprint,
  encodeFingerprint,
  formatFingerprint,
  PAIRING_FINGERPRINT_PARAM,
} from './pairing'

const FINGERPRINT =
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

const options = {
  lanWebAppUrl: 'https://192.168.1.42:9001',
  automergeUrl: 'automerge:2j9knpCseyhnK8izDgqsvbdgAqb9',
  pairingToken: 'a-token',
  rootCertFingerprint: FINGERPRINT,
}

describe('buildGuestUrl', () => {
  it('carries the document, the token and the fingerprint', () => {
    const url = new URL(buildGuestUrl(options)!)

    expect(url.origin).toBe('https://192.168.1.42:9001')
    expect(url.searchParams.get('am')).toBe(options.automergeUrl)
    expect(url.searchParams.get('pt')).toBe('a-token')
    expect(
      decodeFingerprint(url.searchParams.get(PAIRING_FINGERPRINT_PARAM)!),
    ).toBe(FINGERPRINT)
  })

  it('has no link at all without a LAN URL, so no token and no fingerprint', () => {
    expect(buildGuestUrl({ ...options, lanWebAppUrl: undefined })).toBeNull()
  })

  it('has no link before this device has a document', () => {
    expect(buildGuestUrl({ ...options, automergeUrl: null })).toBeNull()
  })

  it('omits the fingerprint when the server is not running over TLS', () => {
    const url = buildGuestUrl({ ...options, rootCertFingerprint: undefined })!

    expect(url).not.toContain(`${PAIRING_FINGERPRINT_PARAM}=`)
    expect(new URL(url).searchParams.get('pt')).toBe('a-token')
  })

  it('omits the token when there is none', () => {
    const url = buildGuestUrl({ ...options, pairingToken: undefined })!

    expect(url).not.toContain('pt=')
    expect(
      decodeFingerprint(
        new URL(url).searchParams.get(PAIRING_FINGERPRINT_PARAM)!,
      ),
    ).toBe(FINGERPRINT)
  })

  it('escapes a token holding URL-significant characters', () => {
    const url = buildGuestUrl({ ...options, pairingToken: 'a&b=c/d' })!

    expect(new URL(url).searchParams.get('pt')).toBe('a&b=c/d')
  })

  it('stays short enough for a phone camera', () => {
    // Base64url rather than hex is what keeps this under the QR version that
    // scans reliably across a room.
    expect(buildGuestUrl(options)!.length).toBeLessThan(180)
  })
})

describe('fingerprint encoding', () => {
  it('round-trips through the link', () => {
    const encoded = encodeFingerprint(FINGERPRINT)

    expect(encoded).toHaveLength(43)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(decodeFingerprint(encoded)).toBe(FINGERPRINT)
  })

  it('reads a value typed as hex or as colon pairs', () => {
    expect(decodeFingerprint(FINGERPRINT.toUpperCase())).toBe(FINGERPRINT)
    expect(decodeFingerprint(formatFingerprint(FINGERPRINT))).toBe(FINGERPRINT)
  })

  it('rejects anything that is not a SHA-256 fingerprint', () => {
    expect(decodeFingerprint('')).toBeNull()
    expect(decodeFingerprint('not a fingerprint')).toBeNull()
    expect(decodeFingerprint('abc123')).toBeNull()
    expect(decodeFingerprint(encodeFingerprint(FINGERPRINT).slice(0, 20))).toBe(
      null,
    )
    expect(() => encodeFingerprint('abc123')).toThrow()
  })

  it('shows the value as uppercase colon-separated pairs', () => {
    expect(formatFingerprint(FINGERPRINT)).toBe(
      '9F:86:D0:81:88:4C:7D:65:9A:2F:EA:A0:C5:5A:D0:15:A3:BF:4F:1B:2B:0B:82:2C:D1:5D:6C:15:B0:F0:0A:08',
    )
  })
})
