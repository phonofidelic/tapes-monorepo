import {
  test,
  expect,
  openApp,
  deviceOptionValues,
  selectDevice,
  recordFor,
  saveRecording,
  expectRecordedBytes,
  decodeLargestRecording,
} from './fixtures'

test.describe('recording', () => {
  test('produces a decodable file and lists it in the library', async ({
    page,
  }) => {
    await openApp(page)

    const devices = await deviceOptionValues(page)
    expect(devices.length).toBeGreaterThan(0)
    await selectDevice(page, devices[0])

    await recordFor(page)
    await saveRecording(page, 'E2E take one')

    await expectRecordedBytes(page)

    // Proves the container and codec are real, not just that bytes exist.
    const decoded = await decodeLargestRecording(page)
    expect(decoded).not.toBeNull()
    expect(decoded?.duration).toBeGreaterThan(1)
    expect(decoded?.sampleRate).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Library' }).click()
    await expect(page.getByText('E2E take one')).toBeVisible()
  })
})
