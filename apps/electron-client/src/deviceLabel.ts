import type http from 'http'
import {
  DEVICE_LABEL_PARAM,
  sanitizeDeviceLabel,
} from '@tapes-monorepo/sync-protocol'

/**
 * Reads the name a guest claims for itself on the sync socket's upgrade
 * request. It is read at the same point as the pairing token, so the host has a
 * name for every connection it accepts.
 *
 * The cap and the character rules come from `@tapes-monorepo/sync-protocol`, so
 * the host and its guests cannot drift apart on what a name may contain. This
 * module is only the host's half: where to find the name on a request.
 *
 * The name is attacker-controlled text that reaches a log line and the UI. It
 * is sanitized here and never interpreted. It is also unverified: two devices
 * can claim the same name.
 */

/** Shown for a guest that sent no usable name. */
export const UNNAMED_DEVICE_LABEL = 'Unnamed device'

/**
 * The name on an upgrade request. It comes from the `d` query parameter, or
 * from an `x-tapes-device-label` header for a client that can set one. The
 * query wins. That is the only form a browser guest has, and a url carries it
 * through a reconnect.
 *
 * Undefined when the guest sent nothing usable. The caller decides what to show
 * instead.
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
