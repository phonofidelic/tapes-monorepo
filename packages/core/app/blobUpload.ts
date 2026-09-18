import type { AppContextValue } from './context/AppContext'
import type { BlobDescriptor } from './types'
import type { IpcService, PutBlobResponse } from './IpcService'
import { uploadBlob, type BlobEndpoint } from './blobClient'
import { callWorker } from './workerClient'

/**
 * Moves recorded bytes from the device that captured them to the sync host,
 * which holds the durable copy every other device fetches from.
 *
 * Electron records straight to disk and hands the host a path, so its bytes
 * never travel. A web guest records into its own OPFS and has to upload.
 */

const PENDING_KEY = 'tapes.pendingBlobUploads'

export type PendingUpload = {
  docUrl: string
  /** OPFS filename on web, absolute path on electron. */
  filepath: string
}

export function readPendingUploads(storage: Storage): PendingUpload[] {
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as PendingUpload[]) : []
  } catch {
    return []
  }
}

export function addPendingUpload(storage: Storage, pending: PendingUpload) {
  const queue = readPendingUploads(storage).filter(
    (entry) => entry.docUrl !== pending.docUrl,
  )
  queue.push(pending)
  storage.setItem(PENDING_KEY, JSON.stringify(queue))
}

export function removePendingUpload(storage: Storage, docUrl: string) {
  storage.setItem(
    PENDING_KEY,
    JSON.stringify(
      readPendingUploads(storage).filter((entry) => entry.docUrl !== docUrl),
    ),
  )
}

/**
 * Sends a recording's audio to the host and returns the descriptor to write
 * into its doc. On web the OPFS file is handed to `fetch` as-is, so it
 * streams off disk and neither side holds the whole recording in memory. On
 * electron the file is already on the host's own disk, so it is ingested over
 * IPC and nothing crosses the network.
 */
export async function uploadRecordingBlob({
  appContext,
  endpoint,
  docUrl,
  filepath,
  mimeType,
}: {
  appContext: AppContextValue
  endpoint: BlobEndpoint
  docUrl: string
  filepath: string
  mimeType: string
}): Promise<BlobDescriptor> {
  if (appContext.type === 'electron-client') {
    return ingestHostFile(appContext.ipc, { filepath, docUrl })
  }

  const { file } = await callWorker<{ file: File }>(
    appContext.worker,
    'storage:get-file',
    { filename: filepath },
  )
  return uploadBlob(endpoint, file, {
    mimeType: file.type || mimeType,
    docUrl,
  })
}

/**
 * Adds a file that is already on the host's disk to its blob store and returns
 * the descriptor to write into the recording's doc. The store hardlinks the
 * file, so the bytes are neither copied nor sent over the network.
 *
 * Electron only. A web guest has no host filesystem to name.
 */
export async function ingestHostFile(
  ipc: IpcService,
  { filepath, docUrl }: { filepath: string; docUrl: string },
): Promise<BlobDescriptor> {
  const response = await ipc.send<PutBlobResponse>('blob:put-file', {
    data: { filepath, docUrl },
  })
  if (!response.success) {
    throw response.error
  }
  return response.data
}
