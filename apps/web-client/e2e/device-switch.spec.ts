import {
  test,
  expect,
  openApp,
  deviceOptions,
  selectDevice,
  recordFor,
  saveRecording,
  readState,
  storedAudioInputDeviceId,
} from './fixtures'

test.describe('input device selection', () => {
  test('records from the newly selected device', async ({ page }) => {
    await openApp(page)

    const devices = await deviceOptions(page)
    // CI provides two PulseAudio virtual sources; a laptop with a single mic
    // should skip rather than fail.
    test.skip(devices.length < 2, 'needs at least two audio input devices')
    const [deviceA, deviceB] = devices

    await selectDevice(page, deviceA)
    await recordFor(page)
    await saveRecording(page, 'take A')

    // Once a device is chosen the Recorder swaps its selector for the record
    // controls, so Settings is the only in-app way to change it.
    await page.getByRole('button', { name: 'Settings' }).click()
    await selectDevice(page, deviceB)
    await page.getByRole('button', { name: 'Recorder' }).click()

    await recordFor(page)
    await saveRecording(page, 'take B')

    const { constructions } = await readState(page)
    expect(constructions).toHaveLength(2)

    // The regression test for TAP-54: the app used to request the device with
    // a bare (ideal) `deviceId`, which Chromium ignores, so both recordings
    // came from the system default. These assert the track really is the
    // device that was asked for.
    expect(constructions[0].trackDeviceId).toBe(deviceA.deviceId)
    expect(constructions[1].trackDeviceId).toBe(deviceB.deviceId)
    expect(constructions[1].trackDeviceId).not.toBe(
      constructions[0].trackDeviceId,
    )
  })

  // The option value carries the whole device so the electron client can read
  // `label` (switchaudio-osx matches on device name) while the web client reads
  // `deviceId`. What gets persisted is still only the deviceId. If the JSON
  // blob ever leaked into settings, getUserMedia would be handed a constraint
  // it cannot match.
  test('serializes the whole device into the option but persists only its id', async ({
    page,
  }) => {
    await openApp(page)

    const devices = await deviceOptions(page)
    expect(devices.length).toBeGreaterThan(0)
    const [device] = devices

    const parsed = JSON.parse(device.value) as MediaDeviceInfo
    expect(parsed.deviceId).toBe(device.deviceId)
    expect(parsed.kind).toBe('audioinput')
    expect(parsed.label).toBe(device.label)
    expect(parsed).toHaveProperty('groupId')

    // The option's visible text is the plain label, not the JSON.
    await expect(
      page.locator('option', { hasText: device.label }).first(),
    ).toHaveText(device.label)

    await selectDevice(page, device)

    await expect
      .poll(() => storedAudioInputDeviceId(page))
      .toBe(device.deviceId)

    // And the recording path really receives that id as a constraint.
    await recordFor(page, 1000)
    const { gumConstraints } = await readState(page)
    const audioConstraints = gumConstraints
      .map((constraint) => constraint.audio)
      .filter(
        (audio): audio is MediaTrackConstraints =>
          typeof audio === 'object' && audio !== null,
      )
    expect(audioConstraints.length).toBeGreaterThan(0)
    expect(JSON.stringify(audioConstraints)).toContain(device.deviceId)
  })
})
