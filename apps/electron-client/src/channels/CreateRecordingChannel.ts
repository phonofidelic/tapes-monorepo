import { IpcChannel } from '@/types'
import { IpcRequest, IpcResponse, ValidIpcChanel } from '@tapes-monorepo/core'
import { SoxRecorder } from './soxRecorder'

export class CreateRecordingChannel implements IpcChannel {
  name: ValidIpcChanel = 'recorder:start'

  constructor(private recorder: SoxRecorder) {}

  handle(request: IpcRequest): IpcResponse {
    const { data } = request
    if (!isValidStartRecordingRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    this.recorder.start(data)

    return { success: true }
  }
}

const isValidStartRecordingRequestData = (
  data: unknown,
): data is {
  storageLocation: string
  audioChannelCount: number
  audioFormat: 'mp3' | 'wav' | 'ogg' | 'flac'
} => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('storageLocation' in data) ||
    typeof data.storageLocation !== 'string' ||
    !('audioChannelCount' in data) ||
    typeof data.audioChannelCount !== 'number' ||
    data.audioChannelCount < 1 ||
    data.audioChannelCount > 2 ||
    !('audioFormat' in data) ||
    typeof data.audioFormat !== 'string' ||
    !['mp3', 'wav', 'ogg', 'flac'].includes(data.audioFormat)
  ) {
    return false
  }
  return true
}
