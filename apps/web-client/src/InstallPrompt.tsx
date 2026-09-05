import { useState, useSyncExternalStore } from 'react'
import {
  clearDeferredPrompt,
  getDeferredPrompt,
  isDismissed,
  isIosSafari,
  isStandalone,
  setDismissed,
  subscribe,
} from './installPromptStore'

/**
 * Offers to install the app. The web client was already installable (manifest,
 * icons, a service worker that precaches the Automerge wasm), but nothing ever
 * offered the install, so users had to find it in a browser menu.
 *
 * Shaped like PwaUpdatePrompt on purpose: same toast, same dark zinc palette in
 * both themes, same dismiss-and-accept pair. The two never appear at once; see
 * ShellPrompts.
 */
export default function InstallPrompt() {
  const deferredPrompt = useSyncExternalStore(subscribe, getDeferredPrompt)
  const [dismissed, setLocallyDismissed] = useState(() => isDismissed())

  // Already installed: there is nothing to offer, and on iOS the hint would
  // otherwise persist forever since there is no event to clear it.
  if (dismissed || isStandalone()) {
    return null
  }

  const iosHint = isIosSafari()
  if (!deferredPrompt && !iosHint) {
    return null
  }

  const dismiss = () => {
    setDismissed()
    setLocallyDismissed(true)
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 m-4 flex items-center justify-between gap-4 rounded-lg bg-zinc-900 p-4 text-sm text-zinc-50 shadow-lg"
    >
      {iosHint ? (
        <p>
          Install Tapes: tap Share in the Safari toolbar, then{' '}
          <span className="whitespace-nowrap">“Add to Home Screen”</span>.
        </p>
      ) : (
        <p>Install Tapes on this device to use it offline.</p>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={dismiss}
        >
          {iosHint ? 'Got it' : 'Not now'}
        </button>
        {!iosHint && (
          <button
            className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200"
            onClick={async () => {
              if (!deferredPrompt) {
                return
              }
              await deferredPrompt.prompt()
              // The event is single-use whatever the user chose; a decline just
              // means the browser may offer another one later.
              await deferredPrompt.userChoice
              clearDeferredPrompt()
            }}
          >
            Install
          </button>
        )}
      </div>
    </div>
  )
}
