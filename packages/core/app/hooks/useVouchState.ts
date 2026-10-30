import { useEffect, useState } from 'react'
import type { SignedVouchState } from '@tapes-monorepo/sync-protocol'
import type { BlobEndpoint } from '@/blobClient'
import { readVouchState } from '@/rosterClient'

/**
 * Whether the host still stands behind the vouch this device holds. Undefined
 * until the host answers, when there is no host to ask, when the read failed,
 * and when the host knows no vouch at that address. Only a withdrawn vouch is
 * worth telling the person about, so the rest read the same.
 *
 * The host's word, not proof: a device cannot check a withdrawal it was never
 * handed. It only decides what Settings says, so the worst a wrong answer
 * costs is a vouch the person did not need to ask for.
 */
export function useVouchState(
  endpoint: BlobEndpoint | undefined,
  address: string | undefined,
): SignedVouchState | undefined {
  const [answer, setAnswer] = useState<{
    address: string
    state: SignedVouchState | undefined
  }>()

  useEffect(() => {
    if (!endpoint || !address) {
      return
    }
    let current = true
    readVouchState(endpoint, address).then(
      (state) => current && setAnswer({ address, state }),
      (error: unknown) =>
        console.warn('Could not read the state of this vouch:', error),
    )
    return () => {
      current = false
    }
  }, [endpoint, address])

  // The answer is kept with the vouch it is about, so a device that has just
  // been vouched for again is never shown the withdrawal of the old one.
  return answer && answer.address === address ? answer.state : undefined
}
