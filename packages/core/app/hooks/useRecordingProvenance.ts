import { useEffect, useState } from 'react'
import type { RecordingProvenance } from '@tapes-monorepo/provenance'
import { useBlobEndpoints } from '@/context/BlobContext'
import {
  checkRecordingProvenance,
  type ProvenanceInput,
} from '@/recordingProvenance'

/**
 * What a recording's signed statements prove, for the Library to show.
 *
 * It checks again whenever the listed statements, the audio or the hosts
 * change. A result is shown only for the recording input it was computed for.
 */

export type ProvenanceState = RecordingProvenance | { state: 'checking' }

const CHECKING: ProvenanceState = { state: 'checking' }

/** The last result, and the input it answered. */
type Held = { key: string; provenance: RecordingProvenance }

export function useRecordingProvenance(
  recording: ProvenanceInput,
): ProvenanceState {
  const endpoints = useBlobEndpoints()
  const { blob, statements } = recording
  // Automerge hands out new objects on every change, so compare by content.
  const key = JSON.stringify({
    blob: blob && { hash: blob.hash, size: blob.size },
    statements,
  })
  const [held, setHeld] = useState<Held>()

  useEffect(() => {
    const controller = new AbortController()
    checkRecordingProvenance(endpoints, JSON.parse(key) as ProvenanceInput, {
      signal: controller.signal,
    }).then(
      (provenance) => setHeld({ key, provenance }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Could not check recording provenance:', error)
        }
      },
    )
    return () => controller.abort()
  }, [endpoints, key])

  return held?.key === key ? held.provenance : CHECKING
}
