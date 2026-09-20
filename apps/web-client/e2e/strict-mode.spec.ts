import {
  test,
  expect,
  openApp,
  deviceOptions,
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

    const devices = await deviceOptions(page)
    expect(devices.length).toBeGreaterThan(0)
    await selectDevice(page, devices[0])

    await recordFor(page)
    await expectRecordedBytes(page)

    const state = await readState(page)

    // Starting and stopping both go through the request helper, so the
    // recording really did talk to the worker.
    expect(state.workerMessageListenerAdds).toBeGreaterThan(1)
    // Each of those listeners came off again once its reply arrived. Nothing
    // is in flight by now, so anything left over is a leak.
    expect(
      state.workerMessageListenerAdds - state.workerMessageListenerRemoves,
    ).toBe(0)

    // The actual regression: a duplicate recorder would write every chunk
    // twice.
    expect(state.mediaRecorderCount).toBe(1)
  })
})
