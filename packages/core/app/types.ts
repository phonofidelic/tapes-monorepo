import { AutomergeUrl } from '@automerge/automerge-repo'

/**
 * Where a recording's audio lives once it is out of the Automerge doc: the
 * sha-256 of the bytes, which is also its address in the host's blob store.
 *
 * Not yet written to `RecordingData` — the recorder starts producing these
 * when playback can resolve them.
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
  // Raw recorded bytes, embedded so the recording syncs peer-to-peer and can be
  // played on a device that did not record it. Written once at creation.
  audio?: Uint8Array
  // MIME type for the embedded bytes (e.g. 'audio/mp4' on web, 'audio/wav' on
  // electron), so playback can build a correctly-typed Blob instead of guessing.
  mimeType?: string
}

export type RecordingRepoState = {
  recordings: AutomergeUrl[]
}
