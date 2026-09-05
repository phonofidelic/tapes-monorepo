import { AutomergeUrl } from '@automerge/automerge-repo'

/**
 * Where a recording's audio lives: the sha-256 of the bytes, which is also its
 * address in the host's blob store.
 */
export type BlobDescriptor = {
  hash: string
  size: number
  mimeType: string
  /** Leading-dot extension, e.g. '.wav'. */
  ext: string
}

export type RecordingData = {
  url: AutomergeUrl
  filename: string
  filepath: string
  name: string
  description?: string
  duration: number
  id: string
  /**
   * Where the audio lives. The bytes themselves are held by the sync host and
   * fetched on demand, so this doc stays O(metadata) however long the
   * recording is. Absent when the bytes have not reached a host yet. A
   * local-only client has nowhere to put them.
   */
  blob?: BlobDescriptor
  /**
   * @deprecated Raw recorded bytes, embedded so the recording could sync
   * peer-to-peer. Read-only: nothing writes this any more. Automerge history
   * is append-only, so docs created before the move to out-of-band audio keep
   * their bytes forever and playback must go on honouring them.
   */
  audio?: Uint8Array
  /** @deprecated MIME type for the legacy embedded `audio` bytes. */
  mimeType?: string
}

export type RecordingRepoState = {
  recordings: AutomergeUrl[]
}
