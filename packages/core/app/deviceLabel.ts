/**
 * The name this device sends to a host when it opens the sync socket.
 *
 * The name rides the upgrade request as `?d=`, next to the pairing token. The
 * host needs it before any document traffic, and a browser cannot set headers
 * on a WebSocket.
 *
 * The name is self-reported and unverified. Two devices can claim the same one.
 * The host re-sanitizes whatever arrives (see the electron client's own
 * `deviceLabel.ts`).
 */

/** Long enough for a name like "Studio iPad", short enough to list. */
export const MAX_DEVICE_LABEL_LENGTH = 64

/** Used when nothing can be derived and the user has set nothing. */
export const FALLBACK_DEVICE_LABEL = 'Unknown device'

/**
 * Reduces a label to one line of plain text. Returns undefined when nothing
 * printable is left, so the caller can fall back instead of showing a blank
 * name.
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

/** Query parameter carrying the name on the upgrade request. */
export const DEVICE_LABEL_PARAM = 'd'

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
