import { asError } from '@/asError'
import { verifyClaimOnIngest } from '@/claimIngest'
import { loadHostSigningKey } from '@/hostSigningKey'
import { getBlobStore } from '@/syncServer'
import {
  IpcChannel,
  IpcRequest,
  PutBlobResponse,
  ValidIpcChanel,
} from '@tapes-monorepo/core'

/**
 * Ingests a just-recorded file into the host's blob store, hardlinking it so
 * the bytes are not duplicated. The renderer writes the returned descriptor
 * into the recording doc; guests then fetch by hash over `/blobs`.
 *
 * The stop channel's claim comes along, and is checked, receipted and stored
 * the same way as a guest's upload.
 */
export class PutBlobChannel implements IpcChannel {
  name: ValidIpcChanel = 'blob:put-file'

  constructor(
    private loadSigningKey: () => Promise<CryptoKeyPair> = loadHostSigningKey,
  ) {}

  async handle(request: IpcRequest): Promise<PutBlobResponse> {
    const { data } = request
    if (!isValidPutBlobRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    const store = getBlobStore()
    if (!store) {
      return { success: false, error: new Error('Blob store is not available') }
    }

    try {
      const { meta } = await store.ingestFile(data.filepath, {
        docUrl: data.docUrl,
      })
      const { claim, attestations } = await verifyClaimOnIngest(
        data.claim,
        meta,
        { loadSigningKey: this.loadSigningKey, store, docUrl: data.docUrl },
      )
      return {
        success: true,
        data: {
          hash: meta.hash,
          size: meta.size,
          mimeType: meta.mimeType,
          ext: meta.ext,
          claim,
          attestations,
        },
      }
    } catch (error) {
      console.error(error)
      return { success: false, error: asError(error) }
    }
  }
}

const isValidPutBlobRequestData = (
  data: unknown,
): data is { filepath: string; docUrl: string; claim?: string } =>
  typeof data === 'object' &&
  data !== null &&
  'filepath' in data &&
  typeof data.filepath === 'string' &&
  data.filepath.length > 0 &&
  'docUrl' in data &&
  typeof data.docUrl === 'string' &&
  data.docUrl.length > 0 &&
  (!('claim' in data) ||
    data.claim === undefined ||
    typeof data.claim === 'string')
