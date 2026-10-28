import { useCallback, useEffect, useState } from 'react'
import type { RosterPerson } from '@tapes-monorepo/sync-protocol'
import type { BlobEndpoint } from '@/blobClient'
import { fetchRoster } from '@/rosterClient'

/**
 * This person's own entry on the host's roster, found by their person key.
 * Null once the host answered without them, as after the operator removed
 * them. Undefined until it has answered, when there is no host to ask, or
 * when the read failed.
 *
 * The entry carries the name and PIN state a vouch request needs, so a device
 * without the person key reads it rather than being told who it is.
 */
export function useRosterSelf(
  endpoint: BlobEndpoint | undefined,
  personKey: string | undefined,
): {
  self: RosterPerson | null | undefined
  /** Reads the roster again, after a change to this entry. */
  refresh: () => void
} {
  const [self, setSelf] = useState<RosterPerson | null>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!endpoint || !personKey) {
      return
    }
    let current = true
    fetchRoster(endpoint).then(
      (people) =>
        current &&
        setSelf(people.find((each) => each.personKey === personKey) ?? null),
      (error: unknown) =>
        console.warn('Could not read the host roster:', error),
    )
    return () => {
      current = false
    }
  }, [endpoint, personKey, version])

  const refresh = useCallback(() => setVersion((each) => each + 1), [])
  return { self, refresh }
}
