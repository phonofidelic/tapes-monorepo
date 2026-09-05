import { useCallback, useEffect, useRef } from 'react'
import type { BlobEndpoint } from './blobClient'
import { useBlobEndpoints } from './context/BlobContext'
import type { PlaySession } from './context/AudioPlayerContext'
import {
  backoffDelay,
  createEvent,
  edgeKey,
  enqueueEvent,
  flushQueue,
  getDeviceId,
  resolveEventTarget,
} from './eventQueue'

/**
 * Wires measured play sessions to the durable queue, and drains that queue
 * whenever a host might be listening.
 *
 * Flushing is opportunistic rather than periodic: the moments worth trying are
 * the ones where something changed — the device came back online, the app came
 * back to the foreground, a host was paired, a play just finished. The backoff
 * timer is the fallback for the case none of those fire, not the main clock.
 */
export function usePlayEventQueue({
  storage = localStorage,
}: { storage?: Storage } = {}): (session: PlaySession) => void {
  const endpoints = useBlobEndpoints()

  // Per edge, and in memory: see `backoffDelay`. Cleared with the session.
  const failuresRef = useRef(new Map<string, number>())
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const inFlightRef = useRef(new Set<string>())
  /** Hosts something asked to flush while a flush to them was already open. */
  const pendingRef = useRef(new Set<string>())
  const mountedRef = useRef(true)

  const endpointsRef = useRef(endpoints)
  useEffect(() => {
    endpointsRef.current = endpoints
  }, [endpoints])

  // The retry timer set inside `flushEndpoint` calls back into it, which a
  // plain reference cannot express in a `useCallback`. The ref also keeps a
  // timer that is already pending pointed at the current closure.
  const flushEndpointRef = useRef<(endpoint: BlobEndpoint) => Promise<void>>(
    async () => {},
  )

  const flushEndpoint = useCallback(
    async (endpoint: BlobEndpoint) => {
      const key = edgeKey(endpoint)
      // One request per host at a time. Two overlapping flushes would send the
      // same batch twice; the host would dedupe it, but the second answer is
      // then written against a queue the first has already cleared. A flush
      // asked for meanwhile is remembered, not dropped — the usual case is a
      // play finishing while the flush from app start is still open, and
      // forgetting it would leave that play waiting for the next reconnect.
      if (inFlightRef.current.has(key)) {
        pendingRef.current.add(key)
        return
      }
      pendingRef.current.delete(key)
      inFlightRef.current.add(key)
      let outcome
      try {
        outcome = await flushQueue(storage, endpoint)
      } finally {
        inFlightRef.current.delete(key)
      }

      // The request outlived the component. Whatever it did or did not clear is
      // already in storage, and the next session picks the queue up from there;
      // scheduling a retry now would leave a timer nothing will ever cancel.
      if (!mountedRef.current) {
        return
      }

      const timers = timersRef.current
      const existing = timers.get(key)
      if (existing !== undefined) {
        clearTimeout(existing)
        timers.delete(key)
      }

      // Anything still queued after the host answered is a retryable rejection
      // — an event whose recording has not synced here yet — so it backs off
      // like an unreachable host rather than being retried immediately.
      const settled =
        outcome.status === 'empty' ||
        (outcome.status === 'flushed' && outcome.remaining === 0)
      if (settled) {
        failuresRef.current.delete(key)
        // The host is reachable and nothing is waiting on a timer, so a flush
        // that arrived mid-request runs now. After a deferred one there is
        // already a backoff timer, and it will carry whatever arrived since.
        if (pendingRef.current.has(key)) {
          await flushEndpointRef.current(endpoint)
        }
        return
      }

      const failures = (failuresRef.current.get(key) ?? 0) + 1
      failuresRef.current.set(key, failures)
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          // The endpoint list may have changed while we waited; only retry a
          // host this device still knows.
          const current = endpointsRef.current.find(
            (candidate) => edgeKey(candidate) === key,
          )
          if (current) {
            void flushEndpointRef.current(current)
          }
        }, backoffDelay(failures)),
      )
    },
    [storage],
  )

  useEffect(() => {
    flushEndpointRef.current = flushEndpoint
  }, [flushEndpoint])

  const flushAll = useCallback(() => {
    for (const endpoint of endpointsRef.current) {
      void flushEndpoint(endpoint)
    }
  }, [flushEndpoint])

  const recordPlaySession = useCallback(
    (session: PlaySession) => {
      const target = resolveEventTarget(
        session.recordingUrl,
        endpointsRef.current,
      )
      if (!target) {
        // No host at all: a standalone web client has nobody to report to, and
        // queueing for a host that may never exist would only fill the cap.
        return
      }
      enqueueEvent(storage, target, createEvent(session, getDeviceId(storage)))
      // A finished play is itself evidence the app is awake; try immediately
      // and let the backoff take over if the host is not there.
      void flushEndpoint(target)
    },
    [flushEndpoint, storage],
  )

  // Flush on mount and whenever the set of known hosts changes — pairing with a
  // host is exactly when a queue that has been waiting can finally go.
  const endpointKeys = endpoints.map(edgeKey).join('\n')
  useEffect(() => {
    flushAll()
  }, [flushAll, endpointKeys])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        flushAll()
      }
    }
    window.addEventListener('online', flushAll)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', flushAll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [flushAll])

  useEffect(() => {
    const timers = timersRef.current
    const pending = pendingRef.current
    const mounted = mountedRef
    mounted.current = true
    return () => {
      mounted.current = false
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      pending.clear()
    }
  }, [])

  return recordPlaySession
}
