import { asError } from '@/asError'
import { IpcChannel } from '@/types'
import { StopRecordingResponse, ValidIpcChanel } from '@tapes-monorepo/core'
import { SoxRecorder } from './soxRecorder'

/**
 * Ends the recording the start channel began and hands back the file it wrote.
 *
 * Registered for the life of the process, like every other channel. Every
 * outcome is an answer, including a stop with nothing running. A rejection
 * here would reach an onClick in the renderer that has no catch.
 */
export class StopRecordingChannel implements IpcChannel {
  name: ValidIpcChanel = 'recorder:stop'

  constructor(private recorder: SoxRecorder) {}

  // Takes no data. The renderer sends the storage location and the elapsed
  // time, which nothing here reads yet. Demanding them only created a way to
  // fail: clearing the storage location mid-recording made every stop invalid,
  // and sox kept running with no way to reach it.
  // TODO: Get metadata, which is what the elapsed time is for.
  async handle(): Promise<StopRecordingResponse> {
    try {
      return { success: true, data: { filepath: await this.recorder.stop() } }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}
