import { useEffect, useState } from 'react'
import { useAppContext } from '@/context/AppContext'
import type {
  IpcResponse,
  PendingVouch,
  PendingVouchesEvent,
} from '@/IpcService'

/**
 * The new devices waiting for this host's operator, on the desktop app. The
 * host pushes the whole list on every change, like the connected-devices list.
 * Subscribe first, then ask for a snapshot, so no change is missed.
 */
export function usePendingVouches(): PendingVouch[] {
  const appContext = useAppContext()
  const ipc = appContext.type === 'electron-client' ? appContext.ipc : undefined
  const [held, setHeld] = useState<{
    pending: PendingVouch[]
    fromEvent: boolean
  }>({ pending: [], fromEvent: false })

  useEffect(() => {
    if (!ipc) {
      return
    }
    let cancelled = false
    const unsubscribe = ipc.subscribe<PendingVouchesEvent>(
      'vouch:pending',
      (payload) => {
        if (!cancelled) {
          setHeld({ pending: payload?.pending ?? [], fromEvent: true })
        }
      },
    )
    ipc.send<IpcResponse | undefined>('vouch:get-pending').then(
      (response) => {
        if (cancelled || !response?.success) {
          return
        }
        const { pending } = (response.data ??
          {}) as Partial<PendingVouchesEvent>
        // An event that already arrived is newer than this snapshot.
        setHeld((current) =>
          current.fromEvent
            ? current
            : { pending: pending ?? [], fromEvent: false },
        )
      },
      (error: unknown) =>
        console.warn('Could not read pending vouches:', error),
    )
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [ipc])

  return held.pending
}
