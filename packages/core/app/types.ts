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

export type Recording = {
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
   * Blob store hashes of signed statements about the audio: the recorder's
   * claim and the host's receipt. The signatures live in the stored objects,
   * not here. Any peer can edit this list, so it proves nothing on its own.
   * A peer can add a hash of a genuine statement about other audio. Count a
   * claim only if its blob hash matches `blob.hash`, and a receipt only if it
   * names such a claim.
   */
  statements?: string[]
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

/**
 * The Automerge document a device opens first, named by the pairing link's
 * `am` parameter. Every recording is reached through it.
 */
export type RootDocument = {
  recordings: AutomergeUrl[]
  /**
   * The session open on the host, absent when none is. Only the host's main
   * process writes this. Other devices read it and must not change it.
   */
  session?: PublishedSession
}

/** An open host session, as published in the root document. */
export type PublishedSession = {
  sessionId: string
  /** ISO 8601. */
  startedAt: string
}

/** A stopped host session, waiting out its grace period before signing. */
export type ClosedSession = {
  sessionId: string
  /** ISO 8601. When the grace period ends and the record is signed. */
  signsAt: string
}

export interface ErrorWithRecover extends Error {
  userMessage?: string | undefined
  recoveryCta: string
  recover(): void
}
