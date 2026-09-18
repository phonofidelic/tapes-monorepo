import { test, expect, type Page } from '@playwright/test'
import { blobObjects, launchTapes, type LaunchedApp } from './electronApp'
import { canCaptureAudio } from './capture'
import { awaitRecording, disposePeer, startPeer } from './peer'
import {
  cachedBlobHashes,
  deviceOptions,
  failureLine,
  openLibrary,
  openRecorder,
  play,
  playerDuration,
  recordFor,
  row,
  saveRecording,
  selectDevice,
  waitForRecordedBytes,
} from './guest'
import { SYNC_PORT } from './ports'

/**
 * The desktop app, driven for real.
 *
 * The web-client suite's host is the embedded sync server started straight from
 * node, and its recordings are seeded with a blob descriptor already attached.
 * That leaves the path which actually *produces* the descriptor — record ->
 * `blob:put-file` over the preload bridge -> ingest into the blob store ->
 * `doc.blob = descriptor` -> a guest fetching by hash — assumed rather than
 * driven. PR #295 fixed a bug that lived entirely inside it: the preload's
 * channel allowlist was missing the blob channels, so `blob:put-file` was
 * dropped without a word and no recording made on the host ever gained a
 * descriptor. The host played its own tapes fine, so nothing on screen said so.
 *
 * Hence the shape of these tests: they assert the *document*, not the player.
 * That bug rendered a perfectly plausible player; the absent descriptor was the
 * defect. A third Automerge peer reads the documents over the wire (`peer.ts`),
 * and the blob store is read off disk.
 *
 * macOS only, and it needs a working default audio input — see `capture.ts`.
 */

let tapes: LaunchedApp
let renderer: Page

test.beforeAll(async () => {
  const capture = await canCaptureAudio()
  if (!capture.ok) {
    // Skipped on a developer's machine, where a missing input device says
    // nothing about the code. Fatal on CI: the nightly runner is configured
    // with a virtual input on purpose, and a run that quietly skipped every
    // test would look exactly like a run that passed.
    if (process.env.CI) {
      throw new Error(
        `The runner cannot capture audio: ${capture.reason}. ` +
          'Check the virtual audio device step in the workflow.',
      )
    }
    // Logged as well as annotated: a skip reason attached in `beforeAll` does
    // not reach the list reporter, and "3 skipped" with no cause is exactly the
    // sort of quiet nothing this suite exists to prevent.
    console.warn(`Skipping the electron e2e suite: ${capture.reason}`)
    test.skip(true, `This machine cannot capture audio: ${capture.reason}`)
  }

  tapes = await launchTapes()
  renderer = tapes.page

  // Playwright's own artifacts — video, screenshots, traces — only ever capture
  // the browser guest, so a failure inside the desktop app would otherwise
  // leave nothing behind but a locator timeout.
  renderer.on('console', (message) => {
    process.stderr.write(`[renderer] ${message.type()}: ${message.text()}\n`)
  })
  renderer.on('pageerror', (error) => {
    process.stderr.write(`[renderer] pageerror: ${error.message}\n`)
  })

  await startPeer({
    syncUrl: `ws://127.0.0.1:${SYNC_PORT}/sync?t=${tapes.pairingToken}`,
  })
})

test.afterAll(async () => {
  await disposePeer()
  await tapes?.close()
})

/** The pairing url this host's QR code encodes: which library, and the token. */
const pairGuest = async (page: Page) => {
  await page.goto(
    `/?am=${encodeURIComponent(tapes.libraryUrl)}&pt=${tapes.pairingToken}`,
  )
  await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
}

test.describe('the electron renderer', () => {
  // First, before the renderer has recorded anything.
  //
  // Both shells capture from the same machine, and `sox` takes the system's
  // default input for the duration of a renderer recording. A browser guest
  // asked for a stream in the wake of that repeatedly got one that produced no
  // bytes at all — measured failing two runs in three when this test ran last,
  // and passing three in three when it ran first.
  test('plays back a tape a browser guest recorded', async ({ page }) => {
    const name = 'Guest tape for renderer'

    await pairGuest(page)
    // The record button only appears once an input device is chosen, and on
    // the guest that is a real choice from what the browser enumerates.
    const devices = await deviceOptions(page)
    expect(devices.length).toBeGreaterThan(0)
    await selectDevice(page, devices[0])

    await recordFor(page)
    await waitForRecordedBytes(page)
    await saveRecording(page, name)

    // The guest uploads over `/blobs` to this same host, so the bytes land in
    // the store the renderer reads from — the reverse leg of the first test.
    const recording = await awaitRecording({
      libraryUrl: tapes.libraryUrl,
      name,
    })
    const stored = (await blobObjects(tapes.userDataPath)).find(
      (object) => object.hash === recording.blob!.hash,
    )
    expect(stored, 'the guest uploaded nothing under this hash').toBeDefined()
    expect(stored!.size).toBe(recording.blob!.size)

    // Nothing of this recording is on this device as a file: its `filepath`
    // names the guest's OPFS. Opening it without a failure line means the
    // renderer resolved the descriptor against its own store rather than
    // deciding it was still uploading, unreachable, or unpaired.
    await openLibrary(renderer)
    await expect(row(renderer, name)).toBeVisible()
    await play(renderer, name)
    await expect(failureLine(renderer)).toBeHidden()

    // And the store really serves those bytes, through the `tapes-blob://`
    // handler the player's source resolves to.
    //
    // Not the transport's duration readout, which test two uses: this tape came
    // from MediaRecorder, whose WebM carries no duration in its header, so the
    // readout is legitimately unknown however well the audio plays. Loading it
    // into an audio element is the assertion that stays true either way.
    const served = await renderer.evaluate(
      (hash) =>
        new Promise<{ loaded: boolean; detail: string }>((resolve) => {
          const audio = new Audio(`tapes-blob://${hash}`)
          const finish = (loaded: boolean, detail: string) =>
            resolve({ loaded, detail })
          audio.addEventListener('loadeddata', () =>
            finish(true, `readyState ${audio.readyState}`),
          )
          audio.addEventListener('error', () =>
            finish(false, `media error ${audio.error?.code ?? 'unknown'}`),
          )
          setTimeout(() => finish(false, 'never loaded'), 15_000)
          audio.load()
        }),
      recording.blob!.hash,
    )
    expect(served.loaded, served.detail).toBe(true)
  })

  test('records, uploads, and the document gains a matching descriptor', async () => {
    const name = 'Renderer tape descriptor'

    await openRecorder(renderer)
    await recordFor(renderer)
    await saveRecording(renderer, name)

    // The document, read from a peer of the host rather than off the screen.
    // This is the assertion PR #295's bug would have failed: the recording
    // appeared in the library either way, and only `blob` was missing.
    const recording = await awaitRecording({
      libraryUrl: tapes.libraryUrl,
      name,
    })
    expect(recording.blob).toBeDefined()
    expect(recording.blob!.mimeType).toBe('audio/wav')
    expect(recording.blob!.size).toBeGreaterThan(44)

    // And the bytes it addresses are in the host's store, under that hash.
    const objects = await blobObjects(tapes.userDataPath)
    const stored = objects.find(
      (object) => object.hash === recording.blob!.hash,
    )
    expect(
      stored,
      `the store holds ${objects.length} object(s), none of them ${recording.blob!.hash}`,
    ).toBeDefined()
    expect(stored!.size).toBe(recording.blob!.size)
  })

  test('records a tape a browser guest can play', async ({ page }) => {
    const name = 'Renderer tape for guest'

    await openRecorder(renderer)
    await recordFor(renderer)
    await saveRecording(renderer, name)
    const recording = await awaitRecording({
      libraryUrl: tapes.libraryUrl,
      name,
    })

    // A genuine second device: its own origin, its own OPFS, paired only by
    // the url it was handed. It has never held these bytes.
    await pairGuest(page)
    await openLibrary(page)
    await expect(row(page, name)).toBeVisible()
    await play(page, name)

    await expect(failureLine(page)).toBeHidden()
    await expect(playerDuration(page)).not.toHaveText('00:00:00')
    // Polled: the fetched bytes are handed to the cache after playback has
    // already started, so this lands slightly after the audio does.
    await expect
      .poll(() => cachedBlobHashes(page))
      .toContain(recording.blob!.hash)
  })
})
