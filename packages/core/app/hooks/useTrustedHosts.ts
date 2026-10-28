import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppContext } from '@/context/AppContext'
import type { TrustedHost } from '@/IpcService'
import {
  readTrustedHosts,
  subscribeToTrustedHosts,
  trustHost,
  untrustHost,
} from '@/trustedHosts'

/**
 * The host keys whose vouches this operator counts, for the Library and for
 * Settings. Empty on anything but the desktop host.
 *
 * The list is shared, so every row renames a vouched person at once when the
 * operator trusts or removes a key.
 */

const NO_KEYS: ReadonlySet<string> = new Set()

export function useTrustedHosts(): {
  hosts: TrustedHost[] | undefined
  /** The same keys, for the trust decision. Empty until the list is read. */
  hostKeys: ReadonlySet<string>
  trust: (host: { hostKey: string; hostLabel?: string }) => Promise<boolean>
  untrust: (hostKey: string) => Promise<boolean>
} {
  const appContext = useAppContext()
  const [hosts, setHosts] = useState<TrustedHost[]>()

  useEffect(() => {
    // Only the desktop host keeps a list, so there is nothing to read on a
    // guest and `hostKeys` stays empty.
    if (appContext.type !== 'electron-client') {
      return
    }
    let current = true
    const read = () => {
      void readTrustedHosts(appContext).then(
        (hosts) => current && setHosts(hosts),
      )
    }
    read()
    const unsubscribe = subscribeToTrustedHosts(read)
    return () => {
      current = false
      unsubscribe()
    }
  }, [appContext])

  const trust = useCallback(
    (host: { hostKey: string; hostLabel?: string }) =>
      trustHost(appContext, host),
    [appContext],
  )
  const untrust = useCallback(
    (hostKey: string) => untrustHost(appContext, hostKey),
    [appContext],
  )

  // Stable, so a caller can pass it to a dependency array.
  const hostKeys = useMemo(
    () => (hosts ? new Set(hosts.map((host) => host.hostKey)) : NO_KEYS),
    [hosts],
  )

  return { hosts, hostKeys, trust, untrust }
}
