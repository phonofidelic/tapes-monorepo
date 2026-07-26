import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Registers the service worker and surfaces an "update available" prompt.
 *
 * The worker is built with `registerType: 'prompt'` (see vite.config.ts), so a
 * new deploy installs in the background and waits rather than activating under
 * a running app — taking it mid-recording would be hostile. This renders the
 * only affordance for accepting it; without one, a returning visitor would sit
 * on the old bundle indefinitely.
 *
 * Mounted only when the bundle is not host-served — vite-plugin-pwa is disabled
 * in that build and this module resolves to a no-op stub, but the toast would
 * still be dead weight in a LAN guest that can never see an update.
 */
export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker registration failed', error)
    },
  })

  if (!needRefresh) {
    return null
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 m-4 flex items-center justify-between gap-4 rounded-lg bg-zinc-900 p-4 text-sm text-zinc-50 shadow-lg"
    >
      <p>A new version of Tapes is available.</p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
        <button
          className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200"
          // `true` activates the waiting worker and reloads the page.
          onClick={() => updateServiceWorker(true)}
        >
          Reload
        </button>
      </div>
    </div>
  )
}
