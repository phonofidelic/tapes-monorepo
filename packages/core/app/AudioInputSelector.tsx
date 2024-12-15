import { useState, useEffect } from 'react'
import { Button } from '@tapes-monorepo/ui'
import { useSettings } from '@/context/SettingsContext'
import clsx from 'clsx'

export function AudioInputSelector({ className }: { className?: string }) {
  const { audioInputDeviceId, setAudioInputDeviceId } = useSettings()
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  )

  useEffect(() => {
    const getMediaDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
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

  if (audioInputDevices.length === 0) {
    return (
      <Button
        className={clsx(className)}
        onClick={async () => {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.error('getUserMedia is not supported in this browser')
            return
          }
          await navigator.mediaDevices.getUserMedia({
            audio: true,
          })
          const foundDevices = await navigator.mediaDevices.enumerateDevices()
          const audioInputs = foundDevices.filter(
            (device) => device.kind === 'audioinput',
          )
          setAudioInputDevices(audioInputs)
        }}
      >
        Select an audio input device
      </Button>
    )
  }

  return (
    <select
      className={clsx(
        'flex appearance-none items-center justify-center rounded bg-transparent p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800',
        className,
      )}
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
