import { useCallback, useEffect, useState } from 'react'
import { useAppContext } from '@/context/AppContext'
import { useHostConnection } from '@/context/HostConnectionContext'
import { resolveDeviceLabel } from '@/deviceLabel'
import {
  createPersonKey,
  readPersonKeyStatus,
  type PersonKeyStatus,
} from '@/personKey'

/**
 * The person key on this device. A web guest makes one the first time it is
 * connected to a host, and certifies its device key with it. Undefined until
 * the worker has answered, and on the desktop host, which has none.
 */
export function usePersonKey(): {
  status: PersonKeyStatus | undefined
  update: (status: PersonKeyStatus) => void
} {
  const appContext = useAppContext()
  const connection = useHostConnection()
  const [status, setStatus] = useState<PersonKeyStatus>()

  useEffect(() => {
    if (appContext.type !== 'web-client') {
      return
    }
    let current = true
    void (async () => {
      try {
        let next = await readPersonKeyStatus(appContext)
        if (!next.exists && connection === 'connected') {
          next = await createPersonKey(
            appContext,
            resolveDeviceLabel({ storage: localStorage, navigator }),
          )
        }
        if (current) {
          setStatus(next)
        }
      } catch (error) {
        // As over plain HTTP, where there is no WebCrypto. Recordings are
        // still signed by the device key alone.
        console.warn('No person key on this device:', error)
      }
    })()
    return () => {
      current = false
    }
  }, [appContext, connection])

  const update = useCallback((next: PersonKeyStatus) => setStatus(next), [])
  return { status, update }
}
