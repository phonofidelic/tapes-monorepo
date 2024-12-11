import { useSettings } from '@/context/SettingsContext'
import { useEffect, useState } from 'react'

export function Settings() {
  return (
    <div className="flex h-full flex-col p-5 pb-20">
      <label className="flex flex-col gap-4">
        <h3>Audio input</h3>
        <AudioInputSelector />
      </label>
    </div>
  )
}

export function AudioInputSelector() {
  const { audioInputDeviceId, setAudioInputDeviceId } = useSettings()
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  )

  useEffect(() => {
    const getMediaDevices = async () => {
      const foundDevices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = foundDevices.filter(
        (device) => device.kind === 'audioinput',
      )
      setAudioInputDevices(audioInputs)
    }

    getMediaDevices()
  }, [])

  return (
    <select
      className="flex size-full appearance-none items-center justify-center rounded bg-transparent p-4 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      onChange={(event) => setAudioInputDeviceId(event.target.value)}
      value={audioInputDeviceId ?? ''}
    >
      <option value="">Select an audio input device</option>
      {audioInputDevices.map((device) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label}
        </option>
      ))}
    </select>
  )
}
