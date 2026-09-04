import { IpcMainEvent } from 'electron'
import { IpcChannel, IpcRequest } from '@/types'
import { collectOrphanedBlobs } from '../blobGc'
import { getBlobStore, getSyncRepo } from '../syncServer'
import { rememberLibraryRoot, syncStoragePath } from '../syncServerConfig'
import type { AutomergeUrl } from '@automerge/automerge-repo/slim'

/**
 * The renderer telling the host which library it just loaded.
 *
 * The host has no notion of a root document otherwise — the url lives in the
 * renderer's localStorage, and everything main receives over IPC is a
 * *recording* doc url. Without it the blob GC has nothing to mark against.
 *
 * This doubles as the GC's trigger. The ticket calls for a sweep "on startup
 * after the repo has loaded", and there is no repo-ready hook on the host: the
 * sync server is started fire-and-forget during `app.on('ready')`, long before
 * any library exists. The renderer announcing its library *is* that moment.
 */
export class AnnounceLibraryChannel implements IpcChannel {
  name: string = 'library:announce'

  /**
   * The renderer re-announces whenever it rebuilds its repo (a host url
   * change, a reconnect), but sweeping the whole store is not something to
   * repeat on every one of those.
   */
  private sweptThisLaunch = false

  async handle(event: IpcMainEvent, request: IpcRequest) {
    const { data } = request
    if (!request.responseChannel) {
      throw new Error(`No response channel provided for ${this.name} request`)
    }

    if (!isValidAnnounceLibraryRequestData(data)) {
      throw new Error(`Invalid data provided for ${this.name} request`)
    }

    try {
      rememberLibraryRoot(data.url)
      event.sender.send(request.responseChannel, {
        success: true,
        data: { acknowledged: true },
      })
    } catch (error) {
      console.error(error)
      event.sender.send(request.responseChannel, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    if (this.sweptThisLaunch) {
      return
    }
    this.sweptThisLaunch = true
    // Best-effort and off the response path: a failed sweep must not surface
    // as a failed announce, exactly as the tmp sweep never blocks startup.
    void this.sweep(data.url).catch((error) =>
      console.error('Blob GC failed:', error),
    )
  }

  private async sweep(url: string) {
    const store = getBlobStore()
    const repo = getSyncRepo()
    if (!store || !repo) {
      return
    }

    const result = await collectOrphanedBlobs({
      repo,
      store,
      storagePath: syncStoragePath(),
      seedRoots: [url as AutomergeUrl],
    })

    if (result.abortedReason) {
      console.warn(`Blob GC did not run: ${result.abortedReason}`)
      return
    }

    console.info(
      `Blob GC: scanned ${result.scanned}, ${result.live} referenced by ` +
        `${result.roots.length} librar${result.roots.length === 1 ? 'y' : 'ies'}, ` +
        `swept ${result.swept.length} (${result.skippedYoung} too recent). ` +
        // Sweeping an object the user still holds in their recordings folder
        // drops one link and frees nothing, so the two numbers differ.
        `Reclaimed ${result.reclaimedBytes} bytes; ${result.stillHardlinked} ` +
        `swept object(s) still hardlinked elsewhere.`,
    )
    for (const hash of result.swept) {
      console.info(`Blob GC swept ${hash}`)
    }
  }
}

const isValidAnnounceLibraryRequestData = (
  data: unknown,
): data is { url: string } =>
  typeof data === 'object' &&
  data !== null &&
  'url' in data &&
  typeof data.url === 'string' &&
  data.url.startsWith('automerge:')
