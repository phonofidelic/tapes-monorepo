import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import { AppContextProvider } from '@/context/AppContext'
import type { AppContextValue } from '@/context/AppContext'
import { SettingsProvider } from '@/context/SettingsContext'
import type { IpcService } from '@/IpcService'
import { AudioInputSelector } from './AudioInputSelector'

// The device list the component renders. `default` and `(Virtual)` entries are
// filtered out by the component, so they double as a guard that the filters
// survive the option-value change.
const builtInMic = {
  deviceId: 'built-in-id',
  kind: 'audioinput',
  label: 'MacBook Pro Microphone',
  groupId: 'group-built-in',
} as MediaDeviceInfo

const usbMic = {
  deviceId: 'usb-id',
  kind: 'audioinput',
  label: 'Scarlett Solo USB',
  groupId: 'group-usb',
} as MediaDeviceInfo

const devices = [
  { ...builtInMic, deviceId: 'default', label: 'Default' } as MediaDeviceInfo,
  builtInMic,
  usbMic,
  {
    deviceId: 'virtual-id',
    kind: 'audioinput',
    label: 'BlackHole (Virtual)',
    groupId: 'group-virtual',
  } as MediaDeviceInfo,
  {
    deviceId: 'speaker-id',
    kind: 'audiooutput',
    label: 'MacBook Pro Speakers',
    groupId: 'group-built-in',
  } as MediaDeviceInfo,
]

const enumerateDevices = vi.fn(async () => devices)
const getUserMedia = vi.fn(async () => ({}) as MediaStream)
const permissionsQuery = vi.fn(async () => ({ state: 'granted' }))

function stubNavigator() {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: permissionsQuery },
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices, getUserMedia },
  })
}

const ipcSend = vi.fn(async () => ({ error: undefined }))

const electronContext = {
  type: 'electron-client',
  ipc: { send: ipcSend } as unknown as IpcService,
} satisfies AppContextValue

const webContext = {
  type: 'web-client',
  worker: {} as unknown as Worker,
} satisfies AppContextValue

async function renderSelector(appContext: AppContextValue) {
  render(
    <AppContextProvider value={appContext}>
      <SettingsProvider>
        <AudioInputSelector />
      </SettingsProvider>
    </AppContextProvider>,
  )
  return waitFor(() => screen.getByRole('combobox'))
}

function storedDeviceId() {
  return JSON.parse(localStorage.getItem('settings') ?? '{}')
    .audioInputDeviceId as string | undefined
}

describe('AudioInputSelector option values', () => {
  beforeEach(() => {
    stubNavigator()
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // The fix: an option carries the whole MediaDeviceInfo, not just the label
  // (electron) or the deviceId (web), so both platforms can read either field.
  it.each([
    ['electron-client', electronContext],
    ['web-client', webContext],
  ] as const)(
    'stringifies the whole device object into the option value on %s',
    async (_name, appContext) => {
      await renderSelector(appContext)

      const option = screen.getByRole('option', {
        name: usbMic.label,
      }) as HTMLOptionElement

      expect(JSON.parse(option.value)).toEqual(usbMic)
    },
  )

  it('keeps the empty placeholder option value empty', async () => {
    await renderSelector(webContext)

    const placeholder = screen.getByRole('option', {
      name: 'Select an audio input device',
    }) as HTMLOptionElement

    expect(placeholder.value).toBe('')
  })

  it('lists only non-default, non-virtual audio inputs', async () => {
    await renderSelector(webContext)

    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Select an audio input device', builtInMic.label, usbMic.label])
  })
})

describe('AudioInputSelector selection', () => {
  beforeEach(() => {
    stubNavigator()
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('persists the deviceId, not the serialized object, on electron', async () => {
    const select = await renderSelector(electronContext)

    fireEvent.change(select, { target: { value: JSON.stringify(usbMic) } })

    await waitFor(() => expect(storedDeviceId()).toBe(usbMic.deviceId))
  })

  it('persists the deviceId on web', async () => {
    const select = await renderSelector(webContext)

    fireEvent.change(select, { target: { value: JSON.stringify(usbMic) } })

    await waitFor(() => expect(storedDeviceId()).toBe(usbMic.deviceId))
  })

  // switchaudio-osx identifies devices by name, so the IPC payload must still
  // be the label even though the option value is now a JSON blob.
  it('sends the device label over IPC on electron', async () => {
    const select = await renderSelector(electronContext)

    fireEvent.change(select, { target: { value: JSON.stringify(usbMic) } })

    await waitFor(() =>
      expect(ipcSend).toHaveBeenCalledWith(
        'settings:set-default-audio-input-device',
        { data: { deviceName: usbMic.label } },
      ),
    )
  })

  it('does not touch IPC on web', async () => {
    const select = await renderSelector(webContext)

    fireEvent.change(select, { target: { value: JSON.stringify(usbMic) } })

    await waitFor(() => expect(storedDeviceId()).toBe(usbMic.deviceId))
    expect(ipcSend).not.toHaveBeenCalled()
  })

  it('clears the setting when the placeholder option is chosen', async () => {
    const select = await renderSelector(webContext)

    fireEvent.change(select, { target: { value: JSON.stringify(usbMic) } })
    await waitFor(() => expect(storedDeviceId()).toBe(usbMic.deviceId))

    fireEvent.change(select, { target: { value: '' } })

    await waitFor(() => expect(storedDeviceId()).toBe(''))
  })

  it('still stores the deviceId when the IPC call fails', async () => {
    ipcSend.mockResolvedValueOnce({
      error: 'no such device',
    } as unknown as { error: undefined })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const select = await renderSelector(electronContext)
    fireEvent.change(select, { target: { value: JSON.stringify(usbMic) } })

    await waitFor(() => expect(storedDeviceId()).toBe(usbMic.deviceId))
    consoleError.mockRestore()
  })
})

describe('AudioInputSelector initial selection', () => {
  beforeEach(() => {
    stubNavigator()
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // The persisted setting is a deviceId while option values are JSON, so the
  // component has to look the device back up to preselect it.
  it('preselects the stored device by looking its deviceId back up', async () => {
    // audioChannelCount/audioFormat have to be present or SettingsContext
    // discards the rest of the stored settings on read.
    localStorage.setItem(
      'settings',
      JSON.stringify({
        audioChannelCount: '1',
        audioFormat: 'wav',
        audioInputDeviceId: usbMic.deviceId,
      }),
    )

    const select = (await renderSelector(webContext)) as HTMLSelectElement

    await waitFor(() => expect(JSON.parse(select.value)).toEqual(usbMic))
  })

  it('falls back to the placeholder when no device is stored', async () => {
    const select = (await renderSelector(webContext)) as HTMLSelectElement

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(select.value).toBe('')
  })
})
