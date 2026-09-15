import type http from 'http'

/**
 * Reads the name a guest claims for itself on the sync socket's upgrade
 * request. It is read at the same point as the pairing token, so the host has
 * a name for every connection it accepts.
 *
 * This mirrors `packages/core/app/deviceLabel.ts`, which is what guests send.
 * It is copied rather than imported because that module is renderer code and
 * this runs in the main process. The cap and the character rules must stay in
 * step. Both test files pin the same cases.
 *
 * The name is attacker-controlled text that reaches a log line and the UI. It
 * is capped, stripped and never interpreted. It is also unverified: two
 * devices can claim the same name.
 */

/** Matches the cap in core. */
export const MAX_DEVICE_LABEL_LENGTH = 64

/** Query parameter carrying the name. A browser cannot set a socket header. */
export const DEVICE_LABEL_PARAM = 'd'

/** Shown for a guest that sent no usable name. */
export const UNNAMED_DEVICE_LABEL = 'Unnamed device'

/**
 * Reduces a name to one line of plain text, or undefined when nothing
 * printable is left.
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

/**
 * The name on an upgrade request. It comes from the `d` query parameter, or
 * from an `x-tapes-device-label` header for a client that can set one. The
 * query wins. That is the only form a browser guest has, and a url carries it
 * through a reconnect.
 *
 * Undefined when the guest sent nothing usable. The caller decides what to
 * show instead.
 */
export function readDeviceLabel(
  request: Pick<http.IncomingMessage, 'headers'>,
  url: URL,
): string | undefined {
  const fromQuery = sanitizeDeviceLabel(
    url.searchParams.get(DEVICE_LABEL_PARAM),
  )
  if (fromQuery) {
    return fromQuery
  }
  const header = request.headers['x-tapes-device-label']
  return sanitizeDeviceLabel(Array.isArray(header) ? header[0] : header)
}
