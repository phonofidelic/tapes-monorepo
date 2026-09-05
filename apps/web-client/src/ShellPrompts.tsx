import { useRegisterSW } from 'virtual:pwa-register/react'
import InstallPrompt from './InstallPrompt'
import PwaUpdatePrompt from './PwaUpdatePrompt'

/**
 * Owns the shell's bottom-of-screen prompts and picks which one may appear.
 * Both toasts are fixed to the bottom, so without an arbiter they would
 * overlap. An offered update wins: it concerns the code currently running, and
 * the install offer will still be there next time. Service worker registration
 * lives here so `useRegisterSW` is called exactly once.
 *
 * Mounted only when the bundle is not host-served. vite-plugin-pwa is disabled
 * for that build, and a LAN guest has nothing to install or update.
 */
export default function ShellPrompts() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker registration failed', error)
    },
  })

  if (needRefresh) {
    return (
      <PwaUpdatePrompt
        onLater={() => setNeedRefresh(false)}
        // `true` activates the waiting worker and reloads the page.
        onReload={() => updateServiceWorker(true)}
      />
    )
  }

  return <InstallPrompt />
}
