import { useCallback, useSyncExternalStore } from 'react'
import {
  readLocalName,
  readLocalNames,
  subscribeToLocalNames,
  type LocalName,
} from '@/localNames'

/**
 * The operator's own names for the keys they recognise, re-read after every
 * change. Several surfaces show the same key, so a name typed on one has to
 * reach the others without a reload.
 */
export function useLocalNames(): LocalName[] {
  return useSyncExternalStore(subscribeToLocalNames, readLocalNames)
}

/** The operator's name for one key, or undefined when they gave none. */
export function useLocalName(key: string | undefined): string | undefined {
  // A string snapshot, so the subscription re-renders on a change to this key
  // and not on a change to some other key in the same store.
  const snapshot = useCallback(() => readLocalName(key), [key])
  return useSyncExternalStore(subscribeToLocalNames, snapshot)
}
