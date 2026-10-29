import { useSyncExternalStore } from 'react'
import {
  readTrustedHosts,
  subscribeToTrustedHosts,
  type TrustedHost,
} from '@/trustedHosts'

/**
 * The hosts whose vouches this reader counts, re-read after every change. The
 * Library and Settings both show the list, so a change in one has to reach
 * the other without a reload.
 */
export function useTrustedHosts(): TrustedHost[] {
  return useSyncExternalStore(subscribeToTrustedHosts, readTrustedHosts)
}
