'use client'

import { useState, useEffect } from 'react'
import { useSettings } from './SettingsContext'

export function AudioInputSelector() {
  const { audioInputDeviceId, setAudioInputDeviceId } = useSettings()
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  )

  useEffect(() => {
    const getMediaDevices = async () => {
      try {
        const foundDevices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = foundDevices.filter(
          (device) => device.kind === 'audioinput',
        )
        setAudioInputDevices(audioInputs)
      } catch (error) {
        console.error('Error accessing media devices:', error)
      }
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
