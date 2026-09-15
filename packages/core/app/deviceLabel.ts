/**
 * The name this device sends to a host when it opens the sync socket.
 *
 * The name rides the upgrade request as `?d=`, next to the pairing token. The
 * host needs it before any document traffic, and a browser cannot set headers
 * on a WebSocket.
 *
 * The cap, the parameter name and the sanitizer live in
 * `@tapes-monorepo/sync-protocol`, because the host applies the same rules to
 * whatever arrives and the two must not drift. What is here is the guest half:
 * deriving a default, reading the user's own name, and putting it on a url.
 *
 * The name is self-reported and unverified. Two devices can claim the same one.
 */

export {
  DEVICE_LABEL_PARAM,
  MAX_DEVICE_LABEL_LENGTH,
  sanitizeDeviceLabel,
} from '@tapes-monorepo/sync-protocol'

import {
  DEVICE_LABEL_PARAM,
  sanitizeDeviceLabel,
} from '@tapes-monorepo/sync-protocol'

/** Used when nothing can be derived and the user has set nothing. */
export const FALLBACK_DEVICE_LABEL = 'Unknown device'

/** The parts of `navigator` this derivation reads. */
export type DeviceLabelNavigator = {
  userAgent?: string
  platform?: string
  userAgentData?: { platform?: string }
  maxTouchPoints?: number
}

/**
 * The default name: the device and its browser, such as "iPhone · Safari".
 * User agents are approximate. The name only has to be recognisable, and the
 * user can change it.
 */
export function deriveDeviceLabel(
  navigator: DeviceLabelNavigator | undefined,
): string {
  if (!navigator) {
    return FALLBACK_DEVICE_LABEL
  }
  const device = derivePlatform(navigator)
  const browser = deriveBrowser(navigator.userAgent ?? '')
  if (device && browser) {
    return `${device} · ${browser}`
  }
  return device ?? browser ?? FALLBACK_DEVICE_LABEL
}

function derivePlatform(navigator: DeviceLabelNavigator): string | undefined {
  const userAgent = navigator.userAgent ?? ''
  if (/iPhone/.test(userAgent)) {
    return 'iPhone'
  }
  if (/iPad/.test(userAgent)) {
    return 'iPad'
  }
  if (/Android/.test(userAgent)) {
    return 'Android'
  }
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? ''
  if (/Mac/.test(platform) || /Mac OS X/.test(userAgent)) {
    // An iPad asking for the desktop site reports itself as a Mac, and the one
    // thing that gives it away is a touchscreen. Macs report zero.
    return (navigator.maxTouchPoints ?? 0) > 1 ? 'iPad' : 'Mac'
  }
  if (/Win/.test(platform) || /Windows/.test(userAgent)) {
    return 'Windows'
  }
  if (/Linux/.test(platform) || /Linux/.test(userAgent)) {
    return 'Linux'
  }
  return undefined
}

function deriveBrowser(userAgent: string): string | undefined {
  // Order matters: every one of these ships "Safari" or "Chrome" in its own
  // user agent, so the most specific match has to be tried first.
  if (/Edg\//.test(userAgent)) {
    return 'Edge'
  }
  if (/OPR\//.test(userAgent)) {
    return 'Opera'
  }
  if (/Firefox\/|FxiOS\//.test(userAgent)) {
    return 'Firefox'
  }
  if (/CriOS\/|Chrome\//.test(userAgent)) {
    return 'Chrome'
  }
  if (/Safari\//.test(userAgent)) {
    return 'Safari'
  }
  return undefined
}

/**
 * The name to present on the socket. The user's own name wins, otherwise the
 * derived default. It takes storage as an argument because both shells need
 * this before React mounts, while they are still building the repo.
 */
export function resolveDeviceLabel({
  storage,
  navigator,
}: {
  storage?: Pick<Storage, 'getItem'>
  navigator?: DeviceLabelNavigator
}): string {
  return (
    readStoredDeviceLabel(storage) ??
    sanitizeDeviceLabel(deriveDeviceLabel(navigator)) ??
    FALLBACK_DEVICE_LABEL
  )
}

/**
 * Reads the stored name out of the settings blob, sanitized. Anything unusable
 * resolves to undefined, so the caller falls back to the derived name. The
 * shells read the same blob the same way for their sync url.
 */
export function readStoredDeviceLabel(
  storage?: Pick<Storage, 'getItem'>,
): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(storage?.getItem('settings') ?? '{}')
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  return sanitizeDeviceLabel((parsed as { deviceLabel?: unknown }).deviceLabel)
}

/**
 * Adds the name to a sync server url. A no-op when there is no usable name, so
 * callers do not have to branch.
 */
export function withDeviceLabel(url: string, label?: string): string {
  const sanitized = sanitizeDeviceLabel(label)
  if (!sanitized) {
    return url
  }
  const withLabel = new URL(url)
  withLabel.searchParams.set(DEVICE_LABEL_PARAM, sanitized)
  return withLabel.toString()
}
