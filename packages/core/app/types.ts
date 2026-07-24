import { AutomergeUrl } from '@automerge/automerge-repo'

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
