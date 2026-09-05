import type { Page } from '@playwright/test'
import {
  test,
  expect,
  cachedBlobHashes,
  deviceOptions,
  recordFor,
  saveRecording,
  selectDevice,
  expectRecordedBytes,
} from './fixtures'
import {
  disposeHost,
  hostPlays,
  hostRecordings,
  restartHost,
  seedRecording,
  startHost,
  stopHost,
  PAIRING_TOKEN,
  type SeededRecording,
} from './host'

/**
 * A play is measured on the guest and counted on the host, and the two are
 * often not connected at the same moment. Everything between them — the
 * durable queue, the retry, the host's dedupe — is covered by unit tests on
 * either side of a `fetch` that never runs. This file is the only place the
 * whole path runs at once: a real browser plays real audio, a real host stores
 * the event, and the count is read back over the route the app reads.
 *
 * The number that matters is "exactly one". Zero means an offline play was
 * lost, which is the case the feature exists for. Two means a retry was
 * counted twice, which is the easiest thing here to get quietly wrong and the
 * hardest to notice, because both numbers look plausible on screen.
 *
 * Same rig as two-device.spec.ts: the host is the electron client's embedded
 * sync server in its own process, and the guest is a browser with its own
 * origin and OPFS. Each test seeds its own tape, because the host's counts
 * outlive a browser context.
 */

let libraryUrl: string

// These tests play audio in real time and then wait out a reconnect backoff,
// which the file-wide 90 second budget cannot cover.
test.beforeEach(() => {
  test.setTimeout(180_000)
})

test.beforeAll(async () => {
  ;({ libraryUrl } = await startHost())
})

test.afterAll(async () => {
  await disposeHost()
})

/** Long enough that a play can clear the five-second threshold and still stop short of the end. */
const TAPE_SECONDS = 60

const seedTape = (name: string): Promise<SeededRecording> =>
  seedRecording({ name, seconds: TAPE_SECONDS, frequency: 330 })

const pair = async (page: Page) => {
  await page.goto(`/?am=${encodeURIComponent(libraryUrl)}&pt=${PAIRING_TOKEN}`)
  await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
  await page.getByRole('button', { name: 'Library' }).click()
}

const row = (page: Page, name: string) =>
  page.locator('div.group').filter({ hasText: name }).first()

const playFrom = async (page: Page, name: string) => {
  await row(page, name).getByTitle('Play recording').click()
}

/** The transport's pause button, which is what closes a play session. */
const pause = (page: Page) => page.getByTitle('Pause').click()

/**
 * Everything this device is holding for a host it has not reached yet.
 *
 * Read straight out of the queue's own storage rather than through the UI,
 * which shows nothing about unsent events. Queues are kept one per host, so
 * this flattens them.
 */
const queuedEvents = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('tapes.eventQueue')
    if (!raw) {
      return []
    }
    const queues = JSON.parse(raw) as Record<
      string,
      { id: string; recordingUrl: string; completion: number }[]
    >
    return Object.values(queues).flat()
  })

/** Plays the host has counted for one recording. */
const plays = async (recordingUrl: string) =>
  (await hostPlays(recordingUrl))?.plays ?? 0

/**
 * Caches a tape's bytes without playing it.
 *
 * A play needs the audio, so a guest that has never held it cannot play it
 * with the host away. Pinning is how a user arranges that, and it counts no
 * play of its own, which keeps the offline play the only one in the test.
 */
const pin = async (page: Page, tape: SeededRecording, name: string) => {
  const tapeRow = row(page, name)
  await tapeRow.getByTitle('Options').click()
  await tapeRow.getByTitle(/Keep this recording playable/).click()
  await expect
    .poll(() => cachedBlobHashes(page))
    .toContain(tape.descriptor.hash)
}

test.describe('playback events', () => {
  test('a play made while the host is away is counted once when it returns', async ({
    page,
  }) => {
    const name = 'Offline play'
    const tape = await seedTape(name)
    await pair(page)
    await pin(page, tape, name)

    await stopHost()
    try {
      await playFrom(page, name)
      // Well past the five-second threshold, and short of the tape's end.
      await page.waitForTimeout(8_000)
      await pause(page)

      // The play was measured and kept. Nothing has been sent: there is
      // nobody to send it to.
      await expect.poll(() => queuedEvents(page)).toHaveLength(1)
    } finally {
      // The host is a per-process singleton; leaving it stopped would take the
      // rest of the file down with it.
      await restartHost()
    }

    // Nothing prompts this. The queue's own backoff timer finds the host, which
    // is what a phone carrying yesterday's plays back onto the LAN relies on.
    await expect.poll(() => plays(tape.url), { timeout: 60_000 }).toBe(1)
    await expect.poll(() => queuedEvents(page)).toHaveLength(0)

    // And it stays one. A queue that cleared itself against the wrong answer
    // would send the same play again on the next timer.
    await page.waitForTimeout(8_000)
    expect(await plays(tape.url)).toBe(1)
  })

  test('a flush whose answer never arrives is retried and still counted once', async ({
    page,
  }) => {
    const name = 'Interrupted flush'
    const tape = await seedTape(name)
    await pair(page)

    // The request reaches the host and its answer is thrown away, which is
    // what a connection dropped mid-flush looks like from the guest: the
    // events are stored, and the queue has no way to know it.
    await page.route('**/events', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      await route.fetch()
      await route.abort('connectionfailed')
    })

    await playFrom(page, name)
    await page.waitForTimeout(8_000)
    await pause(page)

    // The host took it, and the guest still believes it is unsent.
    await expect.poll(() => plays(tape.url), { timeout: 30_000 }).toBe(1)
    expect(await queuedEvents(page)).toHaveLength(1)

    // The retry sends the same event id a second time. This is the assertion
    // the whole dedupe scheme exists for.
    await page.unroute('**/events')
    await expect
      .poll(() => queuedEvents(page), { timeout: 60_000 })
      .toHaveLength(0)
    expect(await plays(tape.url)).toBe(1)
  })

  test('a play shorter than the threshold is not counted at all', async ({
    page,
  }) => {
    const name = 'Brief play'
    const tape = await seedTape(name)
    await pair(page)

    await playFrom(page, name)
    await page.waitForTimeout(2_000)
    await pause(page)

    // Long enough that an event, had one been made, would have been sent.
    await page.waitForTimeout(5_000)
    expect(await queuedEvents(page)).toHaveLength(0)
    expect(await plays(tape.url)).toBe(0)
  })

  test('completion is the furthest point reached, not the time spent playing', async ({
    page,
  }) => {
    const name = 'Replayed opening'
    const tape = await seedTape(name)
    await pair(page)

    await playFrom(page, name)
    await page.waitForTimeout(10_000)

    // Back to the start and listened again. Twenty seconds of a sixty-second
    // tape have now played, but only the first ten were ever reached, so
    // anything near a third would mean the measurement counts time rather
    // than progress.
    await page.getByRole('slider', { name: 'Seek' }).press('Home')
    await page.waitForTimeout(10_000)
    await pause(page)

    await expect.poll(() => plays(tape.url), { timeout: 60_000 }).toBe(1)
    const counted = await hostPlays(tape.url)
    expect(counted!.averageCompletion).toBeGreaterThan(0.05)
    expect(counted!.averageCompletion).toBeLessThan(0.25)
  })

  test('a tape this device recorded is counted, despite its unknown duration', async ({
    page,
  }) => {
    const name = 'Guest recorded tape'
    await pair(page)

    await page.getByRole('button', { name: 'Recorder' }).click()
    const devices = await deviceOptions(page)
    expect(devices.length).toBeGreaterThan(0)
    await selectDevice(page, devices[0])
    // Longer than the four seconds the rest of the suite records: a play has
    // to clear the five-second threshold, and it cannot outlast the tape.
    await recordFor(page, 9_000)
    await expectRecordedBytes(page)
    await saveRecording(page, name)

    // The url this recording got on this device, read back from the host,
    // which is the only place the test can learn it.
    const recordingUrl = await namedRecording(name)

    await page.getByRole('button', { name: 'Library' }).click()
    await expect(row(page, name)).toBeVisible()

    // MediaRecorder writes no duration into its container, so the element
    // reports Infinity until the tape has played through. A completion is a
    // fraction of a length, and the fallback that supplies one is only
    // exercised by real recorder output. No seeded wav reproduces it, and a
    // session with no addressable length is dropped rather than guessed at,
    // so the failure here is a missing play rather than a wrong one.
    await playFrom(page, name)
    // Past the end of the tape, so the session closes on `ended`.
    await page.waitForTimeout(12_000)

    await expect.poll(() => plays(recordingUrl), { timeout: 60_000 }).toBe(1)
    const counted = await hostPlays(recordingUrl)
    expect(counted!.averageCompletion).toBeGreaterThan(0.5)
  })
})

/**
 * Waits for a recording to reach the host and returns its url.
 *
 * A guest's own recording syncs over the socket, so it is on the library a
 * moment after the name is committed rather than at once.
 */
async function namedRecording(name: string): Promise<string> {
  let found: string | undefined
  await expect
    .poll(
      async () => {
        found = (await hostRecordings()).find(
          (recording) => recording.name === name,
        )?.url
        return found
      },
      {
        timeout: 30_000,
        message: `the host never saw a recording named ${name}`,
      },
    )
    .toBeDefined()
  return found!
}
