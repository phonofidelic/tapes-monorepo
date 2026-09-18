import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test'
import { cachedBlobHashes, opfsFiles } from './fixtures'
import { HOST_BUNDLE_DIR } from './hostBundle'
import {
  disposeHost,
  seedRecording,
  startHost,
  HOST_ORIGIN,
  PAIRING_TOKEN,
  type SeededRecording,
} from './host'

/**
 * Streamed playback, the way a LAN guest gets it. The host serves the bundle
 * over its own origin (see hostBundle.ts), so the blob-auth service worker
 * registers and `/blobs` is same-origin. Both are conditions of the path under
 * test, and neither holds anywhere else in the suite: the dev-server specs get
 * no worker at all, and the pwa project previews a standalone build with no
 * host behind it.
 *
 * What the worker buys is the bearer header. An audio element cannot set one,
 * so without the worker the token would have to travel in the query string,
 * and the app would have to fetch whole files to avoid that.
 */

let libraryUrl: string
let tape: SeededRecording
let longTape: SeededRecording

/** Every line the player shows instead of playing. Matches two-device.spec.ts. */
const PLAYBACK_FAILURE =
  /Host unreachable|Pairing expired|Still uploading|have this recording|Not paired with a host/

const failureLine = (page: Page) => page.getByText(PLAYBACK_FAILURE)

test.beforeAll(async () => {
  ;({ libraryUrl } = await startHost({ webClientPath: HOST_BUNDLE_DIR }))
  tape = await seedRecording({ name: 'Streamed tape', seconds: 3 })
  // Big enough that Chromium asks for it in pieces. A file it can swallow in
  // one response puts no `Range` on the wire and finishes loading before the
  // first sample plays, which would make two of these tests vacuous.
  longTape = await seedRecording({
    name: 'Streamed tape long',
    seconds: 600,
    frequency: 220,
  })
})

test.afterAll(async () => {
  await disposeHost()
})

/**
 * Opens the app from the host and waits for the blob-auth worker to be in
 * charge of this page's requests.
 *
 * The wait is not decoration. The worker claims its clients on activate, but a
 * first load races that, and the player asks `navigator.serviceWorker
 * .controller` at the moment a recording loads. Uncontrolled, it takes the
 * buffering fallback and every assertion here would be about the wrong path.
 */
const pairAndWaitForWorker = async (page: Page) => {
  await page.goto(`/?am=${encodeURIComponent(libraryUrl)}&pt=${PAIRING_TOKEN}`)
  await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
  await expect
    .poll(
      () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      {
        timeout: 30_000,
        message: 'the blob-auth service worker never took control of the page',
      },
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Library' }).click()
}

/** One recording's row, as in two-device.spec.ts. */
const row = (page: Page, name: string) =>
  page.locator('div.group').filter({ hasText: name }).first()

const play = async (page: Page, name: string) => {
  await row(page, name).getByTitle('Play recording').click()
}

/** The transport's own duration readout, which only fills in once audio decodes. */
const playerDuration = (page: Page) =>
  page.locator('p', { hasText: /^\d\d:\d\d:\d\d$/ }).last()

/**
 * Requests for recorded audio that the service worker issued, in order.
 *
 * On the context, not the page: a request a worker makes belongs to no frame,
 * and `page.on('request')` never sees it. The filter matters for the same
 * reason the worker does. Each play puts two requests on this event, the
 * element's original and the worker's replacement, and only the second one
 * carries the header.
 */
const watchBlobRequests = (context: BrowserContext): Request[] => {
  const seen: Request[] = []
  context.on('request', (request) => {
    if (request.url().includes('/blobs/') && request.serviceWorker()) {
      seen.push(request)
    }
  })
  return seen
}

/**
 * Hands the spec the audio element the player streams into. It is built with
 * `new Audio()` and never put in the document, so there is nothing to select.
 *
 * Patched here rather than exposed by the app: this is the test's business,
 * and an init script runs before any of the bundle does.
 */
const captureAudioElements = () => {
  const RealAudio = window.Audio
  window.__tapesAudio = []
  window.Audio = function (this: unknown, ...args: [string?]) {
    const audio = new RealAudio(...args)
    window.__tapesAudio.push(audio)
    return audio
  } as unknown as typeof Audio
  window.Audio.prototype = RealAudio.prototype
}

/**
 * The element currently loaded. The newest one with a source, not simply the
 * newest: the player's ref is built during render, so StrictMode's second pass
 * leaves an empty element behind it.
 */
const audioState = (page: Page) =>
  page.evaluate(() => {
    const audio = window.__tapesAudio.filter((element) => element.src).at(-1)
    if (!audio) {
      return null
    }
    return {
      src: audio.src,
      currentTime: audio.currentTime,
      duration: audio.duration,
      bufferedEnd: audio.buffered.length > 0 ? audio.buffered.end(0) : 0,
    }
  })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(captureAudioElements)
})

test.describe('streaming playback', () => {
  test('the service worker authenticates the audio element', async ({
    page,
    context,
  }) => {
    const requests = watchBlobRequests(context)
    await pairAndWaitForWorker(page)

    await play(page, 'Streamed tape')
    await expect(failureLine(page)).toBeHidden()
    await expect(playerDuration(page)).not.toHaveText('00:00:00')

    const download = requests.find((request) => request.method() === 'GET')
    expect(download, 'no GET for the audio reached the host').toBeDefined()

    // The header is the whole point of the worker. The host also accepts `?t=`,
    // so asserting the request succeeded would pass either way.
    expect(await download!.headerValue('authorization')).toBe(
      `Bearer ${PAIRING_TOKEN}`,
    )
    expect(new URL(download!.url()).searchParams.get('t')).toBeNull()

    // And the element is pointed at the host, not at a copy in this tab.
    const audio = await audioState(page)
    expect(audio?.src).toBe(`${HOST_ORIGIN}/blobs/${tape.descriptor.hash}`)
  })

  test('seeking asks the host for a range', async ({ page, context }) => {
    const statuses: number[] = []
    // The context again: these are the worker's responses.
    context.on('response', (response) => {
      if (response.url().includes('/blobs/')) {
        statuses.push(response.status())
      }
    })
    await pairAndWaitForWorker(page)

    await play(page, 'Streamed tape long')
    await expect(failureLine(page)).toBeHidden()
    // Nothing is seekable until the element reports a length to take a
    // fraction of, and the transport disables the bar until then.
    await expect(playerDuration(page)).not.toHaveText('00:00:00')

    // Through the transport rather than the element: a click at four fifths of
    // the bar is the seek a user performs, and it is the app's own code that
    // has to turn it into a request.
    const bar = page.getByRole('slider', { name: 'Seek' })
    const box = (await bar.boundingBox())!
    await bar.click({ position: { x: box.width * 0.8, y: box.height / 2 } })

    await expect
      .poll(() => statuses, {
        timeout: 30_000,
        message: 'the host was never asked for a range',
      })
      .toContain(206)

    await expect
      .poll(async () => (await audioState(page))?.currentTime ?? 0)
      .toBeGreaterThan(300)
    expect((await audioState(page))?.src).toBe(
      `${HOST_ORIGIN}/blobs/${longTape.descriptor.hash}`,
    )
  })

  test('playback starts before the whole file has arrived', async ({
    page,
  }) => {
    await pairAndWaitForWorker(page)

    await play(page, 'Streamed tape long')
    await expect(failureLine(page)).toBeHidden()

    // Sampled while it plays, not after. The claim is that the element starts
    // on a prefix: ten minutes of audio, and the first sample is out while
    // most of the file is still on the host.
    await expect
      .poll(async () => (await audioState(page))?.currentTime ?? 0, {
        timeout: 30_000,
        message: 'playback never advanced',
      })
      .toBeGreaterThan(0)

    const audio = (await audioState(page))!
    expect(audio.duration).toBeGreaterThan(500)
    expect(audio.bufferedEnd).toBeLessThan(audio.duration)

    // Streaming keeps nothing. Pinning is the only thing that writes here, and
    // a recording this device never made leaves no file either.
    expect(await cachedBlobHashes(page)).toEqual([])
    expect(await opfsFiles(page)).toEqual([])
  })
})
