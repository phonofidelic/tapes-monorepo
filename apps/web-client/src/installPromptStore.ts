/**
 * Captures the browser's install prompt. `beforeinstallprompt` routinely fires
 * before React has mounted, so the listener is attached at module scope and
 * the event is held here until something renders a control for it. Calling
 * `preventDefault()` suppresses Chrome's own mini-infobar.
 *
 * The store is a subscribe and snapshot pair, so a component can read it
 * through `useSyncExternalStore` without this module importing React.
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event
  emit()
})

// Fires when the install completes by any route: our button, the browser's own
// menu item, or the OS. Either way there is nothing left to offer.
window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  emit()
})

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDeferredPrompt() {
  return deferredPrompt
}

export function clearDeferredPrompt() {
  deferredPrompt = null
  emit()
}

/**
 * True once the app is running as an installed app rather than a browser tab.
 * `navigator.standalone` is the iOS-only spelling; the media query covers
 * everything else.
 */
export function isStandalone() {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean })
    .standalone
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    iosStandalone === true
  )
}

/**
 * iOS Safari never fires `beforeinstallprompt`, as WebKit has no equivalent
 * API, so there is no event to capture and no button that could do anything.
 * Those users get an instruction instead, which is why this is detected by
 * user agent rather than by feature.
 */
export function isIosSafari() {
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || isIpadOs()
  if (!isIos) {
    return false
  }
  // Every iOS browser is WebKit, but only Safari offers Add to Home Screen;
  // Chrome/Firefox/Edge on iOS all announce themselves in the UA.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

// iPadOS 13+ reports a desktop macOS user agent; the touch point count is the
// conventional way to tell it apart from a real Mac.
function isIpadOs() {
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

const SETTINGS_KEY = 'settings'
const DISMISSED_KEY = 'installPromptDismissed'

function readSettings(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    const parsed: unknown = JSON.parse(raw ?? '{}')
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Dismissal lives in the same `settings` blob as `pairingToken` and
 * `remoteSyncServerUrl` (see main.tsx) rather than a key of its own, so the
 * shell keeps one place where its local preferences are stored.
 */
export function isDismissed() {
  return readSettings()[DISMISSED_KEY] === true
}

export function setDismissed() {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...readSettings(), [DISMISSED_KEY]: true }),
  )
}
