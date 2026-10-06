import { asError } from '@/asError'
import {
  IpcChannel,
  StopRecordingResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'
import {
  createRecordingClaim,
  encodeSignedStatement,
} from '@tapes-monorepo/provenance'
import { hashFile, mimeTypeOfFile } from '@/blobStore'
import { loadHostSigningKey } from '@/hostSigningKey'
import { RecordedTake, SoxRecorder } from './soxRecorder'

/**
 * Ends the recording the start channel began and hands back the file it wrote,
 * with a claim signed by the host's key over the bytes sox captured.
 *
 * Registered for the life of the process, like every other channel. Every
 * outcome is an answer, including a stop with nothing running. A rejection
 * here would reach an onClick in the renderer that has no catch.
 */
export class StopRecordingChannel implements IpcChannel {
  name: ValidIpcChanel = 'recorder:stop'

  constructor(
    private recorder: SoxRecorder,
    private loadSigningKey: () => Promise<CryptoKeyPair> = loadHostSigningKey,
  ) {}

  // Takes no data. The renderer sends the storage location and the elapsed
  // time, which nothing here reads yet. Demanding them only created a way to
  // fail: clearing the storage location mid-recording made every stop invalid,
  // and sox kept running with no way to reach it.
  // TODO: Get metadata, which is what the elapsed time is for.
  async handle(): Promise<StopRecordingResponse> {
    let take: RecordedTake
    try {
      take = await this.recorder.stop()
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
    return {
      success: true,
      data: { filepath: take.filepath, claim: await this.sign(take) },
    }
  }

  // A take without a claim is still a take, so a signing failure is logged
  // and the stop succeeds.
  private async sign(take: RecordedTake): Promise<string | undefined> {
    try {
      const { hash, size } = await hashFile(take.filepath)
      const signed = await createRecordingClaim(
        {
          blob: { hash, size, mimeType: mimeTypeOfFile(take.filepath) },
          startedAt: take.startedAt,
          endedAt: take.endedAt,
        },
        await this.loadSigningKey(),
      )
      return encodeSignedStatement(signed)
    } catch (error) {
      console.warn('Recording saved without a signed claim:', error)
      return undefined
    }
  }
}
