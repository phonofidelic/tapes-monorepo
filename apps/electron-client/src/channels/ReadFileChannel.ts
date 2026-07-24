import path from 'path'
import { readFile } from 'fs/promises'
import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'

// Maps recording file extensions to the MIME type playback needs to build a
// correctly-typed Blob. Mirrors the map in cacheServer.ts.
const mimeTypeByExtension: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

export class ReadFileChannel implements IpcChannel {
  name: string = 'storage:read-file'

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { data } = request
    if (!request.responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

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
      event.sender.send(request.responseChannel, {
        success: true,
        data: { bytes, mimeType },
      })
    } catch (error) {
      console.error(error)
      event.sender.send(request.responseChannel, {
        success: false,
        error,
      })
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
