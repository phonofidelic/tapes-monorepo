/**
 * The pairing link behind the host's QR code, and the fingerprint that rides
 * in it.
 *
 * Three parameters go over: `am` names the Automerge document to open, `pt`
 * carries the pairing token, and `fp` carries the SHA-256 fingerprint of the
 * host's root certificate. Only `pt` is a secret. `fp` is published on
 * purpose: a browser cannot pin a certificate, so nothing checks the root
 * automatically, but a value scanned in the same room as the host is one the
 * person can trust, and comparing it against the root they are about to
 * install is what rules out someone else on the LAN answering as the host.
 *
 * The fingerprint names the root, never the leaf. The leaf is re-issued
 * whenever the LAN IP changes, and a link pinned to it would go stale.
 */

/** Query parameter carrying the host root's fingerprint. */
export const PAIRING_FINGERPRINT_PARAM = 'fp'

/**
 * The fingerprint travels base64url rather than hex. Hex would add 64
 * characters to a link that is already about 120, pushing the QR up two
 * versions and making it harder for a phone camera to read across a room.
 * Base64url spends 43 for the same 32 bytes. The full value is still shown as
 * hex on both the host and the guest, since that is the form people read.
 */
export function encodeFingerprint(hex: string): string {
  const bytes = hexToBytes(hex)
  if (!bytes) {
    throw new Error('Not a SHA-256 fingerprint')
  }
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Reads a fingerprint out of a pairing link back into lowercase hex, or null
 * when the value is not a SHA-256 fingerprint. Accepts hex and colon-separated
 * hex as well as base64url, so a value typed or pasted by hand still works.
 */
export function decodeFingerprint(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (/^[0-9a-fA-F:]+$/.test(trimmed)) {
    const hex = trimmed.replace(/:/g, '').toLowerCase()
    return hexToBytes(hex) ? hex : null
  }

  let binary: string
  try {
    const padded = trimmed
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(trimmed.length / 4) * 4, '=')
    binary = atob(padded)
  } catch {
    return null
  }
  if (binary.length !== 32) {
    return null
  }

  let hex = ''
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Uppercase colon-separated pairs, the form certificate fingerprints are
 * normally shown in. Two people comparing a value across a room read it in
 * pairs, so this is what both the host and the guest display.
 */
export function formatFingerprint(hex: string): string {
  const normalized = hex.replace(/:/g, '').toLowerCase()
  return (normalized.match(/../g) ?? []).join(':').toUpperCase()
}

/** Bytes of a 64-character hex string, or null when it is not one. */
function hexToBytes(hex: string): Uint8Array | null {
  const normalized = hex.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    return null
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** SHA-256 of `bytes` as lowercase hex, for a root a guest has downloaded. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export type GuestUrlOptions = {
  /** LAN-reachable URL of the hosted web client. */
  lanWebAppUrl?: string
  /** Null until this device has a document, which is only briefly at startup. */
  automergeUrl: string | null
  pairingToken?: string
  /** Lowercase hex SHA-256 of the host root, when running over TLS. */
  rootCertFingerprint?: string
}

/**
 * The link the host shows as a QR code, or null when there is nothing to pair
 * with. Anyone holding it can read and write the host's recordings: the token
 * in it opens both the sync socket and `/blobs`.
 *
 * Without a LAN URL there is no link at all, so the token and the fingerprint
 * never appear on their own. A link needs a document to point at too, so a
 * device that has yet to create one shows nothing rather than a link reading
 * `am=null`.
 */
export function buildGuestUrl({
  lanWebAppUrl,
  automergeUrl,
  pairingToken,
  rootCertFingerprint,
}: GuestUrlOptions): string | null {
  if (!lanWebAppUrl || !automergeUrl) {
    return null
  }

  // `am` is left unescaped, as it has been: an Automerge URL is already
  // URL-safe, and encoding it now would change every link in circulation.
  let url = `${lanWebAppUrl}/?am=${automergeUrl}`
  if (pairingToken) {
    url += `&pt=${encodeURIComponent(pairingToken)}`
  }
  if (rootCertFingerprint) {
    url += `&${PAIRING_FINGERPRINT_PARAM}=${encodeFingerprint(
      rootCertFingerprint,
    )}`
  }
  return url
}
