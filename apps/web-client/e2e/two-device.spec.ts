import type { Page } from '@playwright/test'
import {
  test,
  expect,
  cachedBlobHashes,
  deviceOptions,
  opfsFiles,
  recordFor,
  saveRecording,
  selectDevice,
} from './fixtures'
import {
  disposeHost,
  hostObjects,
  restartHost,
  seedRecording,
  startHost,
  stopHost,
  PAIRING_TOKEN,
  type SeededRecording,
} from './host'

/**
 * Host↔guest, over the wire.
 *
 * The rest of the suite runs one browser against a dev server with no host at
 * all, which leaves the seam this project is built on — a guest that syncs
 * metadata over a socket and fetches audio over HTTP from another device —
 * tested only by hand. Here a real embedded sync server runs alongside the
 * suite in its own process (see `host.ts`), the guest's dev server proxies
 * `/sync` and `/blobs` to it, and the browser is a genuine second device: its
 * own origin, its own OPFS, paired only by the url it was handed.
 *
 * Each test gets a fresh browser context, so a guest never inherits the OPFS
 * or localStorage of the one before it — which is what makes "this device
 * holds only what it played" a real assertion rather than an artifact of
 * ordering.
 */

let libraryUrl: string
let tapeOne: SeededRecording
let tapeTwo: SeededRecording
let longTape: SeededRecording

test.beforeAll(async () => {
  ;({ libraryUrl } = await startHost())
  tapeOne = await seedRecording({ name: 'Host tape one', seconds: 2 })
  tapeTwo = await seedRecording({
    name: 'Host tape two',
    seconds: 1,
    frequency: 660,
  })
  // Long enough that Chromium streams it in pieces rather than swallowing it
  // whole, which is what puts a `Range` request on the wire when we seek.
  longTape = await seedRecording({
    name: 'Host tape long',
    seconds: 600,
    frequency: 220,
  })
})

test.afterAll(async () => {
  await disposeHost()
})

/** The pairing url a host's QR code encodes: which library, and the token. */
const pair = async (page: Page) => {
  await page.goto(`/?am=${encodeURIComponent(libraryUrl)}&pt=${PAIRING_TOKEN}`)
  await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
  await page.getByRole('button', { name: 'Library' }).click()
}

/**
 * One recording's row. `div.group`, not `li`: Library maps its recordings
 * straight to `LibraryListItem`, which renders a div — the `group` class is
 * there to drive the row's hover states, and is the only marker the row has.
 */
const row = (page: Page, name: string) =>
  page.locator('div.group').filter({ hasText: name }).first()

const play = async (page: Page, name: string) => {
  await row(page, name).getByTitle('Play recording').click()
}

/** The transport's own duration readout, which only fills in once audio decodes. */
const playerDuration = (page: Page) =>
  page.locator('p', { hasText: /^\d\d:\d\d:\d\d$/ }).last()

test.describe('host and guest', () => {
  test('a guest plays a tape it never recorded', async ({ page }) => {
    await pair(page)

    await expect(row(page, 'Host tape one')).toBeVisible()
    await play(page, 'Host tape one')

    // The bytes were only ever on the host: this device has no recording of
    // its own and had never seen this hash.
    await expect(page.getByText('Not available offline')).toBeHidden()
    await expect(playerDuration(page)).not.toHaveText('00:00:00')
    // Polled: the fetched bytes are handed to the cache after playback has
    // already started, so this lands slightly after the audio does.
    await expect
      .poll(() => cachedBlobHashes(page))
      .toContain(tapeOne.descriptor.hash)
  })

  test('a guest keeps only what it played, not the library', async ({
    page,
  }) => {
    await pair(page)

    await play(page, 'Host tape two')
    await expect
      .poll(() => cachedBlobHashes(page))
      .toContain(tapeTwo.descriptor.hash)

    // Two other tapes are in this library and stayed on the host.
    expect(await cachedBlobHashes(page)).toEqual([tapeTwo.descriptor.hash])
    // Nor did playing one leave a recording file behind: those are for audio
    // this device captured.
    expect(await opfsFiles(page)).toEqual([])
  })

  test('a recording made on the guest reaches the host and the other device', async ({
    page,
    context,
  }) => {
    await pair(page)
    const before = await hostObjects()

    const other = await context.browser()!.newPage()
    await other.goto(
      `/?am=${encodeURIComponent(libraryUrl)}&pt=${PAIRING_TOKEN}`,
    )
    await expect(other.getByRole('button', { name: 'Library' })).toBeVisible()
    await other.getByRole('button', { name: 'Library' }).click()

    await page.getByRole('button', { name: 'Recorder' }).click()
    const devices = await deviceOptions(page)
    expect(devices.length).toBeGreaterThan(0)
    await selectDevice(page, devices[0])
    await recordFor(page)
    await saveRecording(page, 'Guest take one')

    // The upload is a POST to `/blobs`, so the host gaining an object is the
    // honest end of it — a row in the guest's own library proves nothing.
    await expect
      .poll(async () => (await hostObjects()).length, { timeout: 30_000 })
      .toBe(before.length + 1)

    const uploaded = (await hostObjects()).find(
      (object) => !before.some((existing) => existing.hash === object.hash),
    )
    expect(uploaded?.size).toBeGreaterThan(0)

    // And the metadata reached the second device over the sync socket.
    await expect(other.getByText('Guest take one')).toBeVisible({
      timeout: 30_000,
    })
    await other.close()
  })

  test('a pinned tape survives the host going away, an unpinned one does not', async ({
    page,
  }) => {
    await pair(page)

    // Scoped to the row: every row has this menu, and by now the library also
    // holds whatever the recording test left in it.
    const tape = row(page, 'Host tape one')
    await tape.getByTitle('Options').click()
    await tape.getByTitle(/Keep this recording playable/).click()
    await expect
      .poll(() => cachedBlobHashes(page))
      .toContain(tapeOne.descriptor.hash)

    await stopHost()
    try {
      await play(page, 'Host tape one')
      await expect(page.getByText('Not available offline')).toBeHidden()
      await expect(playerDuration(page)).not.toHaveText('00:00:00')

      // Never played, never pinned, and now there is nobody to ask.
      await play(page, 'Host tape two')
      await expect(page.getByText('Not available offline')).toBeVisible()
    } finally {
      // The host is a per-process singleton; leaving it stopped would take the
      // rest of the file down with it.
      await restartHost()
    }
  })

  test('seeking a long tape asks the host for a range', async ({ page }) => {
    await pair(page)

    const statuses: number[] = []
    page.on('response', (response) => {
      if (response.url().includes('/blobs/')) {
        statuses.push(response.status())
      }
    })

    // Straight at the host's HTTP surface, with the element the app's player
    // uses: `<audio>` is what turns a seek into a `Range` request, and only a
    // real one exercises what Chromium actually sends.
    const seeked = await page.evaluate(
      async ({ hash, token }) => {
        // `?t=` rather than a bearer header, for the reason `tokenAuth.ts` gives:
        // a plain `<audio src>` cannot set one.
        const audio = new Audio(`/blobs/${hash}?t=${token}`)
        audio.preload = 'auto'
        await new Promise((resolve, reject) => {
          audio.addEventListener('loadedmetadata', resolve, { once: true })
          audio.addEventListener(
            'error',
            () => reject(new Error('load failed')),
            {
              once: true,
            },
          )
        })
        const target = audio.duration * 0.9
        await new Promise((resolve, reject) => {
          audio.addEventListener('seeked', resolve, { once: true })
          audio.addEventListener(
            'error',
            () => reject(new Error('seek failed')),
            {
              once: true,
            },
          )
          audio.currentTime = target
        })
        return { currentTime: audio.currentTime, duration: audio.duration }
      },
      { hash: longTape.descriptor.hash, token: PAIRING_TOKEN },
    )

    expect(seeked.duration).toBeGreaterThan(500)
    expect(seeked.currentTime).toBeGreaterThan(seeked.duration * 0.8)
    await expect.poll(() => statuses).toContain(206)
  })
})
