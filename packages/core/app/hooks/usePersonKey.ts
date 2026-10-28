import { useCallback, useEffect, useState } from 'react'
import type { RosterPerson } from '@tapes-monorepo/sync-protocol'
import { useAppContext } from '@/context/AppContext'
import { useUploadEndpoint } from '@/context/BlobContext'
import { useHostConnection } from '@/context/HostConnectionContext'
import { resolveDeviceLabel } from '@/deviceLabel'
import {
  createPersonKey,
  readPersonKeyStatus,
  type PersonKeyStatus,
} from '@/personKey'
import { fetchRoster } from '@/rosterClient'

/**
 * The person key on this device. A web guest makes one the first time it is
 * connected to a host, and certifies its device key with it. Undefined until
 * the worker has answered, and on the desktop host, which has none.
 *
 * When the host already knows people, the guest may be one of them on a new
 * device. Then no key is made until the person says they are new, and
 * `roster` lists who they might be.
 */
export function usePersonKey(): {
  status: PersonKeyStatus | undefined
  /** People the host knows, while this device has no person key. */
  roster: RosterPerson[]
  update: (status: PersonKeyStatus) => void
  /** Makes the person key, for a person who is new to the host. */
  create: () => Promise<void>
} {
  const appContext = useAppContext()
  const connection = useHostConnection()
  const endpoint = useUploadEndpoint()
  const [status, setStatus] = useState<PersonKeyStatus>()
  const [roster, setRoster] = useState<RosterPerson[]>([])

  useEffect(() => {
    if (appContext.type !== 'web-client') {
      return
    }
    let current = true
    void (async () => {
      try {
        let next = await readPersonKeyStatus(appContext)
        if (!next.exists && connection === 'connected') {
          const people = endpoint
            ? await fetchRoster(endpoint).catch((error: unknown) => {
                console.warn('Could not read the host roster:', error)
                return []
              })
            : []
          if (people.length > 0) {
            if (current) {
              setRoster(people)
            }
          } else {
            next = await createPersonKey(
              appContext,
              resolveDeviceLabel({ storage: localStorage, navigator }),
            )
          }
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
  }, [appContext, connection, endpoint])

  const update = useCallback((next: PersonKeyStatus) => setStatus(next), [])
  const create = useCallback(async () => {
    setStatus(
      await createPersonKey(
        appContext,
        resolveDeviceLabel({ storage: localStorage, navigator }),
      ),
    )
  }, [appContext])
  return { status, roster, update, create }
}
