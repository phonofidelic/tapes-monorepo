import {
  test,
  expect,
  openApp,
  deviceOptionValues,
  selectDevice,
  recordFor,
  saveRecording,
  readState,
} from './fixtures'

test.describe('input device selection', () => {
  test('records from the newly selected device', async ({ page }) => {
    await openApp(page)

    const devices = await deviceOptionValues(page)
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
    expect(constructions[0].trackDeviceId).toBe(deviceA)
    expect(constructions[1].trackDeviceId).toBe(deviceB)
    expect(constructions[1].trackDeviceId).not.toBe(
      constructions[0].trackDeviceId,
    )
  })
})
