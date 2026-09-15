/**
 * The device name a guest sends on the sync socket handshake.
 *
 * Guests build the name, and the host re-sanitizes whatever arrives. Both sides
 * must agree on the cap and the character rules, so they are defined once here
 * rather than copied. See the package header for why this is its own package.
 */

/** Long enough for a name like "Studio iPad", short enough to list. */
export const MAX_DEVICE_LABEL_LENGTH = 64

/**
 * Query parameter carrying the name on the upgrade request, next to the pairing
 * token's `t`. A browser cannot set headers on a WebSocket.
 */
export const DEVICE_LABEL_PARAM = 'd'

/**
 * Reduces a name to one line of plain text. Returns undefined when nothing
 * printable is left, so the caller can fall back instead of showing a blank
 * name.
 *
 * On the host this runs on attacker-controlled input that reaches a log line
 * and the UI.
 */
export function sanitizeDeviceLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const cleaned = value
    // Cc is the control characters, Cf the invisible formatting ones, Zl and Zp
    // the line and paragraph separators. Stripping them stops a name from
    // forging a log line or reordering the text around it.
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DEVICE_LABEL_LENGTH)
    // Cutting by code unit can leave a trailing space or half a surrogate pair.
    .replace(/[\s\p{Cs}]+$/gu, '')
  return cleaned.length > 0 ? cleaned : undefined
}
