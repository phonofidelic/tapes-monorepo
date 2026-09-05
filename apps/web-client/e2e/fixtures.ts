import { test as base, expect, type Page } from '@playwright/test'
import type { E2EState, RecorderConstruction } from './globals'

/**
 * Installed before any app code runs. Wraps the browser APIs the recording
 * path uses so tests can assert on what the app actually asked for, rather
 * than only on what ended up on screen.
 */
const installInstrumentation = () => {
  const state: E2EState = {
    mediaRecorderCount: 0,
    constructions: [],
    gumConstraints: [],
    workerMessageListenerAdds: 0,
    workerMessageListenerRemoves: 0,
  }
  window.__tapesE2E = state

  const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  )
  navigator.mediaDevices.getUserMedia = (
    constraints?: MediaStreamConstraints,
  ) => {
    if (constraints) {
      state.gumConstraints.push(constraints)
    }
    return realGetUserMedia(constraints)
  }

  // Subclass rather than proxy: RecordingContext calls the *static*
  // MediaRecorder.isTypeSupported before constructing, and `extends` inherits
  // statics for free.
  const RealMediaRecorder = window.MediaRecorder
  class CountingMediaRecorder extends RealMediaRecorder {
    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
      super(stream, options)
      const track = stream.getAudioTracks()[0]
      state.mediaRecorderCount += 1
      state.constructions.push({
        trackDeviceId: track?.getSettings().deviceId,
        trackLabel: track?.label ?? '',
      })
    }
  }
  window.MediaRecorder = CountingMediaRecorder as typeof MediaRecorder

  // Message-listener churn on the recording worker. Under dev StrictMode the
  // effect in RecordingContext mounts, unmounts and remounts, so a correct
  // implementation adds two listeners and removes one.
  const realAdd = Worker.prototype.addEventListener
  const realRemove = Worker.prototype.removeEventListener
  Worker.prototype.addEventListener = function (
    this: Worker,
    ...args: Parameters<Worker['addEventListener']>
  ) {
    if (args[0] === 'message') {
      state.workerMessageListenerAdds += 1
    }
    return realAdd.apply(this, args)
  }
  Worker.prototype.removeEventListener = function (
    this: Worker,
    ...args: Parameters<Worker['removeEventListener']>
  ) {
    if (args[0] === 'message') {
      state.workerMessageListenerRemoves += 1
    }
    return realRemove.apply(this, args)
  }
}

export const test = base.extend({
  // Note the parameter is named `provide`, not Playwright's usual `use`:
  // a bare `use(...)` call reads as a React hook to eslint-plugin-react-hooks.
  page: async ({ page }, provide) => {
    await page.addInitScript(installInstrumentation)
    await provide(page)
  },
})

export { expect }

export const readState = (page: Page): Promise<E2EState> =>
  page.evaluate(() => window.__tapesE2E)

/** Navigates to the app and waits for the Automerge repo to resolve. */
export const openApp = async (page: Page) => {
  await page.goto('/')
  // App renders "Loading..." until the repo exists, so the nav is the signal.
  await expect(page.getByRole('button', { name: 'Recorder' })).toBeVisible()
}

/** One entry per non-placeholder option in AudioInputSelector. */
export type DeviceOption = {
  /** What the app persists and later passes as a getUserMedia constraint. */
  deviceId: string
  /** The option's visible text, and what the electron client sends over IPC. */
  label: string
  /** The raw option value: a stringified MediaDeviceInfo. */
  value: string
}

/**
 * Audio input devices offered by AudioInputSelector, minus its placeholder.
 *
 * Option values are whole stringified MediaDeviceInfo objects, not bare device
 * ids. The two clients need different fields off the same option, so the
 * selector serializes the lot and each reads what it needs.
 */
export const deviceOptions = async (page: Page): Promise<DeviceOption[]> => {
  const select = page.getByRole('combobox').first()

  // AudioInputSelector renders an "Allow access" button until its permission
  // query resolves, then swaps in the <select>. Clicking that button is racy:
  // it is often gone by the time the click lands, and Playwright then waits
  // forever on a detached element. Wait for the select instead, and only take
  // the explicit path if it never arrives.
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
    return { deviceId: parsed.deviceId, label: parsed.label, value }
  })
}

export const selectDevice = async (page: Page, device: DeviceOption) => {
  // Target the select that offers this device rather than a positional one.
  // The Settings view has three comboboxes and the device selector populates
  // last, after a permissions query and enumerateDevices, so `.first()` can
  // land on the format select on a slow machine. Matched by option text, not
  // an `option[value]` selector: the value is JSON, whose quotes and braces
  // would need escaping.
  const select = page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: device.label }) })
  await expect(select).toBeVisible()
  await select.selectOption({ label: device.label })
}

/** The audioInputDeviceId the app has persisted, if any. */
export const storedAudioInputDeviceId = (page: Page) =>
  page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as {
      audioInputDeviceId?: string
    }
    return settings.audioInputDeviceId
  })

/**
 * Records for `durationMs`. Four seconds by default: at one second Chromium
 * intermittently emits a single zero-byte blob (measured 3/5 and 1/5 on CI
 * runners), while 4s was clean across 12 trials.
 */
export const recordFor = async (page: Page, durationMs = 4000) => {
  // getByTitle, not getByRole+name: while recording the button renders the
  // elapsed Timer, and text content wins over `title` when the accessible name
  // is computed. The button is then named "00:00:04:21", not "Stop recording".
  await page.getByTitle('Start recording').click()
  await page.waitForTimeout(durationMs)
  await page.getByTitle('Stop recording').click()
}

/** Saves the pending recording, optionally renaming it first. */
export const saveRecording = async (page: Page, name?: string) => {
  if (name) {
    // Likewise: this button's accessible name is the current recording name.
    await page.getByTitle(/^Rename /).click()
    const input = page.locator('#new-recording-name-input')
    await expect(input).toBeVisible()
    await input.fill(name)
    // Enter commits the name and creates the Automerge document.
    await input.press('Enter')
    return
  }
  await page.getByTitle('Save recording').click()
}

export const opfsFiles = (page: Page) =>
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
 * Hashes of the blobs this device has cached, from playing or pinning them.
 *
 * The recording files a device made itself live flat in the OPFS root (see
 * `opfsFiles`); fetched blobs live in `blobs/` under their content hash, so
 * these two never see each other's files.
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

/**
 * The bytes land on the final `dataavailable` -> `recorder:write`, strictly
 * after the worker has already answered `recorder:stop`, so this must poll.
 */
export const expectRecordedBytes = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const files = await opfsFiles(page)
        return Math.max(0, ...files.map((file) => file.size))
      },
      {
        timeout: 20_000,
        message: 'no OPFS file ever reached a non-zero size',
      },
    )
    .toBeGreaterThan(0)
}

/**
 * Decodes the recorded bytes in-page. This is the honest "is it playable?"
 * check: AudioPlayerContext keeps its HTMLAudioElement in a ref and never
 * mounts it, so there is no <audio> element in the DOM to inspect.
 */
export const decodeLargestRecording = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    let best: ArrayBuffer | null = null
    for await (const handle of root.values()) {
      if (handle.kind !== 'file') continue
      const buffer = await (await handle.getFile()).arrayBuffer()
      if (!best || buffer.byteLength > best.byteLength) best = buffer
    }
    if (!best) return null
    const audioContext = new AudioContext()
    try {
      const decoded = await audioContext.decodeAudioData(best)
      return {
        duration: decoded.duration,
        sampleRate: decoded.sampleRate,
        channels: decoded.numberOfChannels,
      }
    } finally {
      await audioContext.close()
    }
  })

export type { E2EState, RecorderConstruction }
