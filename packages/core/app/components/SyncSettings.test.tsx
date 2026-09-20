import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { generateAutomergeUrl } from '@automerge/automerge-repo'
import { AppContextProvider } from '@/context/AppContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { SyncSettings } from '@/components/SyncSettings'
import type {
  ConnectedDevicesEvent,
  GetConnectedDevicesResponse,
  SyncConnection,
  SyncServerInfo,
} from '@/services/SyncService'
import { IpcService } from '@/IpcService'

/**
 * What the host's sync panel says about who is connected.
 *
 * The list is easy. The states around it are the ones that mislead someone
 * looking at their own screen. A host that could not read its registry must
 * never read as a host nobody has joined, and a row must keep saying how long
 * a device has been there without a reload.
 */

const HOST_DOC_URL = generateAutomergeUrl()

/** A fixed past instant, so a row's age never comes out negative. */
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)

const serverInfo: SyncServerInfo = {
  running: true,
  url: 'wss://127.0.0.1:9001',
  lanWebAppUrl: 'https://192.168.1.5:9001',
  pairingToken: 'host-token',
  port: 9001,
  host: '0.0.0.0',
}

const thisDevice: SyncConnection = {
  id: 'sync-connection-host',
  label: 'Studio Mac',
  connectedAt: NOW,
  self: true,
}

const aPhone: SyncConnection = {
  id: 'sync-connection-1',
  label: 'Studio phone',
  address: '192.168.1.24',
  connectedAt: NOW,
  self: false,
}

/**
 * A stand-in for the Temporal global.
 *
 * The rows date themselves with Temporal, which only the Electron renderer's
 * Chromium has. Node and jsdom have neither, so without this the panel throws
 * on its first row. The arithmetic mirrors the one call the rows make:
 * `since` truncated to whole minutes, carried up to hours.
 */
function installTemporalStub() {
  const instantFrom = (epochMilliseconds: number) => ({
    epochMilliseconds,
    since(other: { epochMilliseconds: number }) {
      const totalMinutes = Math.trunc(
        (epochMilliseconds - other.epochMilliseconds) / 60_000,
      )
      return {
        hours: Math.trunc(totalMinutes / 60),
        minutes: totalMinutes % 60,
      }
    },
  })

  vi.stubGlobal('Temporal', {
    Now: { instant: () => instantFrom(Date.now()) },
    Instant: { fromEpochMilliseconds: instantFrom },
  })
}

type FakeIpc = {
  ipc: IpcService
  /** Pushes a connected-devices event the way the main process would. */
  emit: (payload: ConnectedDevicesEvent) => void
  unsubscribe: ReturnType<typeof vi.fn>
}

/**
 * An IpcService that answers per channel.
 *
 * Answering every channel with the same object is what makes a connected-
 * devices fixture quietly land in the error branch: the server info it hands
 * back has no `success`, so the panel reads it as a failure.
 */
function fakeIpc(
  connectedDevices:
    GetConnectedDevicesResponse | Promise<GetConnectedDevicesResponse>,
): FakeIpc {
  const listeners: ((payload: ConnectedDevicesEvent) => void)[] = []
  const unsubscribe = vi.fn(() => {
    listeners.length = 0
  })

  const ipc = {
    send: vi.fn((channel: string) => {
      if (channel === 'sync:get-connected-devices') {
        return Promise.resolve(connectedDevices)
      }
      return Promise.resolve(serverInfo)
    }),
    subscribe: vi.fn(
      (_event: string, listener: (payload: ConnectedDevicesEvent) => void) => {
        listeners.push(listener)
        return unsubscribe
      },
    ),
  } as unknown as IpcService

  return {
    ipc,
    emit: (payload) => {
      for (const listener of listeners) {
        listener(payload)
      }
    },
    unsubscribe,
  }
}

const ok = (connections: SyncConnection[]): GetConnectedDevicesResponse =>
  ({ success: true, data: { connections } }) as GetConnectedDevicesResponse

const failed = (): GetConnectedDevicesResponse =>
  ({
    success: false,
    error: new Error('registry unavailable'),
  }) as unknown as GetConnectedDevicesResponse

const renderHostSyncSettings = (ipc: IpcService) =>
  render(
    <AppContextProvider value={{ type: 'electron-client', ipc }}>
      <SettingsProvider>
        <SyncSettings />
      </SettingsProvider>
    </AppContextProvider>,
  )

/** The panel a row lives in, so a query cannot pick up the guest link copy. */
const connectedDevicesPanel = async () =>
  (await screen.findByText('Connected devices:')).parentElement!

describe('SyncSettings: the connected device list', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('automergeUrl', HOST_DOC_URL)
    localStorage.setItem(
      'settings',
      JSON.stringify({
        syncServerMode: 'embedded',
        syncServerLanEnabled: 'true',
      }),
    )
    window.history.replaceState({}, '', '/')
    installTemporalStub()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('names this device and every guest that has joined', async () => {
    const { ipc } = fakeIpc(ok([thisDevice, aPhone]))

    renderHostSyncSettings(ipc)

    const panel = await connectedDevicesPanel()
    expect(within(panel).getByText('Studio Mac')).toBeInTheDocument()
    expect(within(panel).getByText('Studio phone')).toBeInTheDocument()
  })

  // Someone reading their own screen has to find themselves in the list before
  // the other names mean anything.
  it('marks only this device as this device', async () => {
    const { ipc } = fakeIpc(ok([thisDevice, aPhone]))

    renderHostSyncSettings(ipc)

    const badges = within(await connectedDevicesPanel()).getAllByText(
      'This device',
    )
    expect(badges).toHaveLength(1)
    expect(badges[0].parentElement).toHaveTextContent('Studio Mac')
  })

  // A guest may send no usable name. A row with a blank where the name goes
  // reads as a bug rather than as an unnamed device.
  it('falls back to a placeholder name for a guest that sent none', async () => {
    const { ipc } = fakeIpc(ok([{ ...aPhone, label: undefined }]))

    renderHostSyncSettings(ipc)

    expect(
      within(await connectedDevicesPanel()).getByText('Unknown device'),
    ).toBeInTheDocument()
  })

  // Two phones can carry the same name. The address is what tells them apart.
  it('shows the address a guest connected from', async () => {
    const { ipc } = fakeIpc(ok([aPhone]))

    renderHostSyncSettings(ipc)

    expect(await connectedDevicesPanel()).toHaveTextContent('192.168.1.24')
  })

  it('leaves the address out when the host did not report one', async () => {
    const { ipc } = fakeIpc(ok([{ ...aPhone, address: undefined }]))

    renderHostSyncSettings(ipc)

    expect(await connectedDevicesPanel()).not.toHaveTextContent('·')
  })
})

describe('SyncSettings: how long a device has been connected', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('automergeUrl', HOST_DOC_URL)
    localStorage.setItem(
      'settings',
      JSON.stringify({ syncServerMode: 'embedded' }),
    )
    window.history.replaceState({}, '', '/')
    // shouldAdvanceTime keeps testing-library's polling queries alive while
    // the clock is fake; without it every `find*` waits forever.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    installTemporalStub()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // Under a minute there is nothing to round to, and "0 minutes ago" is worse
  // than saying so plainly.
  it('reads as just now for a device that arrived seconds ago', async () => {
    const { ipc } = fakeIpc(ok([{ ...aPhone, connectedAt: NOW - 20_000 }]))

    renderHostSyncSettings(ipc)

    expect(await connectedDevicesPanel()).toHaveTextContent(
      'Connected just now',
    )
  })

  it('counts in hours and minutes once there is something to count', async () => {
    const { ipc } = fakeIpc(
      ok([{ ...aPhone, connectedAt: NOW - (65 * 60_000 + 5_000) }]),
    )

    renderHostSyncSettings(ipc)

    expect(await connectedDevicesPanel()).toHaveTextContent(
      'Connected 1 hour, 5 minutes ago',
    )
  })

  // The panel is a thing people leave open. A row that froze at the moment it
  // rendered would keep claiming a device just arrived.
  it('keeps counting while the panel stays open', async () => {
    const { ipc } = fakeIpc(ok([{ ...aPhone, connectedAt: NOW }]))

    renderHostSyncSettings(ipc)
    expect(await connectedDevicesPanel()).toHaveTextContent(
      'Connected just now',
    )

    await act(() => vi.advanceTimersByTimeAsync(3 * 60_000))

    expect(await connectedDevicesPanel()).toHaveTextContent(
      'Connected 3 minutes ago',
    )
  })
})

describe('SyncSettings: an empty or unreadable device list', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('automergeUrl', HOST_DOC_URL)
    localStorage.setItem(
      'settings',
      JSON.stringify({ syncServerMode: 'embedded' }),
    )
    window.history.replaceState({}, '', '/')
    installTemporalStub()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // The host's own window is always in the list. Nobody else being there is
  // the state that needs explaining.
  it('explains how to invite a guest when only this device is connected', async () => {
    const { ipc } = fakeIpc(ok([thisDevice]))

    renderHostSyncSettings(ipc)

    expect(
      await screen.findByText('No guest devices connected.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Studio Mac')).toBeInTheDocument()
  })

  // An empty registry and an unreadable one both draw a panel with no guests
  // in it. They mean opposite things, so they must not read the same.
  it('says the list may be wrong when the host could not answer', async () => {
    const { ipc } = fakeIpc(failed())

    renderHostSyncSettings(ipc)

    expect(
      await screen.findByText("Can't tell who is connected."),
    ).toBeInTheDocument()
    expect(screen.queryByText('Connected devices:')).not.toBeInTheDocument()
    expect(
      screen.queryByText('No guest devices connected.'),
    ).not.toBeInTheDocument()
  })

  // The server may not have been running when the panel mounted. A push is
  // proof that it is now, so the message must give way to the list.
  it('shows the list once a push arrives after a failed snapshot', async () => {
    const { ipc, emit } = fakeIpc(failed())

    renderHostSyncSettings(ipc)
    await screen.findByText("Can't tell who is connected.")

    act(() => emit({ connections: [thisDevice] }))

    expect(await screen.findByText('Studio Mac')).toBeInTheDocument()
    expect(
      screen.queryByText("Can't tell who is connected."),
    ).not.toBeInTheDocument()
  })

  it('asks the host again when the retry button is pressed', async () => {
    const { ipc } = fakeIpc(failed())
    const asked = () =>
      vi
        .mocked(ipc.send)
        .mock.calls.filter(
          ([channel]) => channel === 'sync:get-connected-devices',
        ).length

    renderHostSyncSettings(ipc)
    await screen.findByText("Can't tell who is connected.")
    expect(asked()).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(asked()).toBe(2))
  })
})

describe('SyncSettings: staying current with the host', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('automergeUrl', HOST_DOC_URL)
    localStorage.setItem(
      'settings',
      JSON.stringify({ syncServerMode: 'embedded' }),
    )
    window.history.replaceState({}, '', '/')
    installTemporalStub()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // The host pushes the whole list on every connect and disconnect, so the
  // panel replaces what it holds rather than merging into it.
  it('replaces the list when the host pushes a new one', async () => {
    const { ipc, emit } = fakeIpc(ok([thisDevice, aPhone]))

    renderHostSyncSettings(ipc)
    await screen.findByText('Studio phone')

    act(() => emit({ connections: [thisDevice] }))

    await waitFor(() =>
      expect(screen.queryByText('Studio phone')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Studio Mac')).toBeInTheDocument()
  })

  // A device can join between the request and its answer. The snapshot is
  // older than the push by then, and writing it would drop the new device
  // until something else changed.
  it('does not let a late snapshot undo a push that already landed', async () => {
    let resolveSnapshot: (
      response: GetConnectedDevicesResponse,
    ) => void = () => {}
    const snapshot = new Promise<GetConnectedDevicesResponse>((resolve) => {
      resolveSnapshot = resolve
    })
    const { ipc, emit } = fakeIpc(snapshot)

    renderHostSyncSettings(ipc)
    await waitFor(() => expect(ipc.subscribe).toHaveBeenCalled())

    act(() => emit({ connections: [thisDevice, aPhone] }))
    await screen.findByText('Studio phone')

    resolveSnapshot(ok([thisDevice]))
    await waitFor(() => expect(ipc.send).toHaveBeenCalled())

    expect(screen.getByText('Studio phone')).toBeInTheDocument()
  })

  // The listener holds a setState on an unmounted panel otherwise, and the
  // main process keeps sending to a window that stopped caring.
  it('stops listening when the panel goes away', async () => {
    const { ipc, unsubscribe } = fakeIpc(ok([thisDevice]))

    const { unmount } = renderHostSyncSettings(ipc)
    await screen.findByText('Studio Mac')

    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
