import { expect, type Page } from '@playwright/test'

/**
 * Drives the shared UI from either shell.
 *
 * These mirror the helpers in `apps/web-client/e2e/fixtures.ts` and are copied
 * rather than imported. The two suites run under different tsconfigs and
 * workspace dependencies, and a few selectors are easier to keep in step.
 * Every helper works against the electron renderer and a browser guest alike,
 * since both render the same core views.
 */

/** One entry per non-placeholder option in AudioInputSelector. */
export type DeviceOption = {
  /** What the app persists and later passes as a getUserMedia constraint. */
  deviceId: string
  /** The option's visible text. */
  label: string
}

/**
 * Audio input devices a browser guest is offering, minus the placeholder.
 *
 * Guest only. In the renderer, picking a device changes the system default
 * input that sox captures from, so `launchTapes` seeds its device setting
 * instead of driving this.
 */
export const deviceOptions = async (page: Page): Promise<DeviceOption[]> => {
  const select = page.getByRole('combobox').first()

  // AudioInputSelector shows an "Allow access" button until its permission
  // query resolves, then swaps in the select. Clicking that button is racy: it
  // is often gone before the click lands, and Playwright then waits forever on
  // a detached element. Wait for the select, and fall back to the click.
  try {
    await select.waitFor({ state: 'visible', timeout: 5_000 })
  } catch {
    await page
      .getByRole('button', { name: 'Allow access to audio input devices' })
      .click()
    await select.waitFor({ state: 'visible', timeout: 10_000 })
  }

  const values = await select
    .locator('option')
    .evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value) => value !== ''),
    )

  return values.map((value) => {
    const parsed = JSON.parse(value) as MediaDeviceInfo
    return { deviceId: parsed.deviceId, label: parsed.label }
  })
}

/** Picks an input device, which is what reveals the record button. */
export const selectDevice = async (page: Page, device: DeviceOption) => {
  // Matched by option text against the select that actually offers this device,
  // rather than a positional one: the Settings view has three comboboxes and
  // the device selector populates last.
  const select = page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: device.label }) })
  await expect(select).toBeVisible()
  await select.selectOption({ label: device.label })
}

/**
 * Records for `durationMs`. Four seconds by default, matching the web-client
 * suite: shorter captures intermittently produce a zero-length file.
 */
export const recordFor = async (page: Page, durationMs = 4000) => {
  // getByTitle, not getByRole. While recording the button renders the elapsed
  // timer, and text content wins over `title` for the accessible name, so the
  // button is named "00:00:04:21" rather than "Stop recording".
  await page.getByTitle('Start recording').click()
  await page.waitForTimeout(durationMs)
  await page.getByTitle('Stop recording').click()
}

/** Files a browser guest has recorded, which live flat in the OPFS root. */
const opfsFiles = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const files: { name: string; size: number }[] = []
    for await (const handle of root.values()) {
      if (handle.kind !== 'file') continue
      files.push({ name: handle.name, size: (await handle.getFile()).size })
    }
    return files
  })

/**
 * Waits until a guest's recording has finished being written.
 *
 * `recordFor` returns when stop is clicked, but the last bytes land after the
 * worker has already answered the stop request. Saving inside that window
 * uploads a truncated file that decodes to a zero-length tape. So this waits
 * for the size to stop growing, not merely to become non-zero.
 */
export const waitForRecordedBytes = async (page: Page) => {
  const largest = async () =>
    Math.max(0, ...(await opfsFiles(page)).map((file) => file.size))

  await expect
    .poll(largest, {
      timeout: 20_000,
      message: 'no OPFS file ever reached a non-zero size',
    })
    .toBeGreaterThan(0)

  let previous = -1
  for (let settled = 0; settled < 3;) {
    const size = await largest()
    settled = size === previous ? settled + 1 : 0
    previous = size
    await page.waitForTimeout(250)
  }
}

/** Names the pending recording and commits it, creating its document. */
export const saveRecording = async (page: Page, name: string) => {
  // Likewise: this button's accessible name is the current recording name.
  await page.getByTitle(/^Rename /).click()
  const input = page.locator('#new-recording-name-input')
  await expect(input).toBeVisible()
  await input.fill(name)
  await input.press('Enter')
}

/**
 * One recording's row. Library renders each recording as a div with the
 * `group` class, which drives hover states and is the row's only marker.
 */
export const row = (page: Page, name: string) =>
  page.locator('div.group').filter({ hasText: name }).first()

export const openLibrary = async (page: Page) => {
  await page.getByRole('button', { name: 'Library' }).click()
}

/**
 * Puts the app back on a clean Recorder view.
 *
 * A reload rather than a click. Once a tape has been opened the transport is
 * docked over the bottom of every view, right on top of the record button, and
 * its Stop button does not dismiss it. Nothing is lost by reloading because the
 * library lives on the embedded server, not in the window.
 */
export const openRecorder = async (page: Page) => {
  await page.reload()
  const recorder = page.getByRole('button', { name: 'Recorder' })
  await recorder.waitFor({ state: 'visible', timeout: 30_000 })
  await recorder.click()
}

export const play = async (page: Page, name: string) => {
  await row(page, name).getByTitle('Play recording').click()
}

/**
 * Every line the player shows instead of playing. Asserting against the set
 * keeps "it played" from quietly passing when one of these is reworded, which
 * a check for one literal string would not.
 */
export const PLAYBACK_FAILURE =
  /Host unreachable|Pairing expired|Still uploading|have this recording|Not paired with a host/

export const failureLine = (page: Page) => page.getByText(PLAYBACK_FAILURE)

/** The transport's own duration readout, which only fills in once audio decodes. */
export const playerDuration = (page: Page) =>
  page.locator('p', { hasText: /^\d\d:\d\d:\d\d$/ }).last()

/**
 * Hashes of the blobs a browser guest has cached, from playing or pinning them.
 * Meaningless in the renderer, which has no OPFS store. The electron client
 * caches into the blob store its own sync server owns.
 */
export const cachedBlobHashes = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const hashes: string[] = []
    try {
      const directory = await root.getDirectoryHandle('blobs')
      for await (const handle of directory.values()) {
        if (handle.kind === 'file') hashes.push(handle.name)
      }
    } catch {
      // No blob has ever been cached on this device.
    }
    return hashes
  })
