import {
  test,
  expect,
  openApp,
  deviceOptionValues,
  selectDevice,
  recordFor,
  expectRecordedBytes,
  readState,
} from './fixtures'

test.describe('StrictMode', () => {
  test('constructs exactly one MediaRecorder per recording', async ({
    page,
  }) => {
    await openApp(page)

    // Guard, not decoration: StrictMode does not double-invoke in a production
    // build, so this whole test silently becomes a tautology if the harness is
    // ever pointed at `vite preview`. Fail loudly instead.
    const isDevServer = await page.evaluate(
      () =>
        Boolean(window.__vite_plugin_react_preamble_installed__) ||
        Boolean(document.querySelector('script[src*="@vite/client"]')),
    )
    expect(
      isDevServer,
      'expected the dev server, where StrictMode double-invokes effects',
    ).toBe(true)

    const devices = await deviceOptionValues(page)
    expect(devices.length).toBeGreaterThan(0)
    await selectDevice(page, devices[0])

    await recordFor(page)
    await expectRecordedBytes(page)

    const state = await readState(page)

    // The double-invoke really happened: RecordingContext's effect mounted
    // more than once. Without this, "one recorder" proves nothing.
    expect(state.workerMessageListenerAdds).toBeGreaterThan(1)
    // ...and its cleanup ran, leaving exactly one live listener.
    expect(
      state.workerMessageListenerAdds - state.workerMessageListenerRemoves,
    ).toBe(1)

    // The actual regression: a leaked duplicate listener would start a second
    // recorder on the same `recorder:start:response`.
    expect(state.mediaRecorderCount).toBe(1)
  })
})
