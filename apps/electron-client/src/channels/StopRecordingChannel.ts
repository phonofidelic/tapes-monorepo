import { IpcChannel } from '@/types'
import {
  IpcRequest,
  StopRecordingResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'
import { SoxRecorder } from './soxRecorder'

/**
 * Ends the recording the start channel began and hands back the file it wrote.
 *
 * Registered for the life of the process, like every other channel. A stop with
 * nothing running is answered as a failure, which is what the renderer branches
 * on.
 */
export class StopRecordingChannel implements IpcChannel {
  name: ValidIpcChanel = 'recorder:stop'

  constructor(private recorder: SoxRecorder) {}

  async handle(request: IpcRequest): Promise<StopRecordingResponse> {
    if (!isValidStopRecordingRequestData(request.data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    try {
      // TODO: Get metadata
      return { success: true, data: { filepath: await this.recorder.stop() } }
    } catch (error) {
      console.error(error)
      return { success: false, error: new Error('Could not end sox process') }
    }
  }
}

const isValidStopRecordingRequestData = (
  data: unknown,
): data is {
  storageLocation: string
  duration: number
} => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('storageLocation' in data) ||
    typeof data.storageLocation !== 'string' ||
    !('duration' in data) ||
    typeof data.duration !== 'number'
  ) {
    return false
  }
  return true
}
