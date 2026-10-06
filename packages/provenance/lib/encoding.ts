/**
 * Byte encodings used in statements: base64url for keys and signatures, and
 * lowercase hex for sha-256 hashes, matching the host's blob store addresses.
 */

const BASE64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Unpadded base64url (RFC 4648 section 5). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6))
    for (let c = 0; c < chars; c++) {
      out += BASE64URL[(chunk >> (18 - c * 6)) & 0x3f]
    }
  }
  return out
}

/**
 * Decodes unpadded base64url. Returns undefined for anything else, including
 * an encoding with stray trailing bits, so each byte string has one spelling.
 */
export function fromBase64Url(
  text: string,
): Uint8Array<ArrayBuffer> | undefined {
  if (text.length % 4 === 1) {
    return undefined
  }
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8))
  let buffer = 0
  let bits = 0
  let index = 0
  for (const char of text) {
    const value = BASE64URL.indexOf(char)
    if (value === -1) {
      return undefined
    }
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[index++] = (buffer >> bits) & 0xff
    }
  }
  if ((buffer & ((1 << bits) - 1)) !== 0) {
    return undefined
  }
  return bytes
}

export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
