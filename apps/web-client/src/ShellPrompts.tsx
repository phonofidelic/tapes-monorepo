import { useRegisterSW } from 'virtual:pwa-register/react'
import InstallPrompt from './InstallPrompt'
import PwaUpdatePrompt from './PwaUpdatePrompt'

/**
 * Owns the shell's bottom-of-screen prompts and picks which one may appear.
 *
 * Both toasts are `fixed bottom-0`, so without an arbiter they would sit on top
 * of each other. An update the user has already been offered wins: it is about
 * the code currently running, and the install offer will still be there next
 * time. Service worker registration lives here rather than in the toast so that
 * `useRegisterSW` is called exactly once.
 *
 * Mounted only when the bundle is not host-served: vite-plugin-pwa is disabled
 * for that build (so `virtual:pwa-register/react` is a no-op stub), and a LAN
 * guest served by the Electron host has no manifest to install and no update to
 * take.
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
