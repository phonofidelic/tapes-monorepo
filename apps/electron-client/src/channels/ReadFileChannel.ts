import path from 'path'
import { readFile } from 'fs/promises'
import { asError } from '@/asError'
import { IpcChannel } from '@/types'
import {
  IpcRequest,
  ReadFileResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

// Maps recording file extensions to the MIME type playback needs to build a
// correctly-typed Blob.
const mimeTypeByExtension: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

export class ReadFileChannel implements IpcChannel {
  name: ValidIpcChanel = 'storage:read-file'

  async handle(request: IpcRequest): Promise<ReadFileResponse> {
    const { data } = request
    if (!isValidReadFileRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    const { filepath } = data

    try {
      const buffer = await readFile(filepath)
      // Hand Automerge a plain Uint8Array so it stores the bytes as a native
      // binary column rather than serializing a Node Buffer object.
      const bytes = new Uint8Array(buffer)
      const mimeType =
        mimeTypeByExtension[path.extname(filepath).toLowerCase()] ??
        'application/octet-stream'
      return { success: true, data: { bytes, mimeType } }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}

const isValidReadFileRequestData = (
  data: unknown,
): data is { filepath: string } => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'filepath' in data &&
    typeof data.filepath === 'string' &&
    data.filepath.length > 0
  )
}
