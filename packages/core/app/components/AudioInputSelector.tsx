import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { Button } from '@tapes-monorepo/ui'
import { useAppContext } from '@/context/AppContext'
import { useSetting } from '@/context/SettingsContext'
import { IpcResponse } from '@/IpcService'

export function AudioInputSelector({ className }: { className?: string }) {
  const appContext = useAppContext()
  const [audioInputDeviceId, setAudioInputDeviceId] =
    useSetting('audioInputDeviceId')
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  )

  useEffect(() => {
    const getMediaDevices = async () => {
      try {
        const foundDevices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = foundDevices
          .filter((device) => device.kind === 'audioinput')
          .filter((device) => device.deviceId !== 'default')
          .filter((device) => !device.label.match(/\(Virtual\)/))

        setAudioInputDevices(audioInputs)
      } catch (error) {
        console.error('Error accessing media devices:', error)
      }
    }

    getMediaDevices()
  }, [])

  if (!audioInputDevices.length) {
    return <Button className={className}>Loading devices...</Button>
  }

  return (
    <select
      className={clsx(
        'flex appearance-none items-center justify-center rounded bg-transparent p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800',
        className,
      )}
      onClick={async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          console.error('getUserMedia is not supported in this browser')
          return
        }
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
        const foundDevices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = foundDevices
          .filter((device) => device.kind === 'audioinput')
          .filter((device) => device.deviceId !== 'default')
          .filter((device) => !device.label.match(/\(Virtual\)/))

        setAudioInputDevices(audioInputs)
      }}
      onChange={async (event) => {
        if (!event.target.value) {
          setAudioInputDeviceId('')
          return
        }
        if (appContext.type === 'electron-client') {
          try {
            const setAudioInputDeviceResponse =
              await appContext.ipc.send<IpcResponse>(
                'settings:set-default-audio-input-device',
                {
                  data: {
                    deviceName: event.target.value,
                  },
                },
              )
            if (setAudioInputDeviceResponse.error) {
              throw setAudioInputDeviceResponse.error
            }
          } catch (error) {
            console.error('Error setting default audio input device:', error)
          }
        }
        setAudioInputDeviceId(event.target.value)
      }}
      defaultValue={audioInputDeviceId ?? ''}
    >
      <option value="">Select an audio input device</option>
      {audioInputDevices.map((device) => (
        <option
          key={device.deviceId}
          value={
            appContext.type === 'electron-client'
              ? device.label
              : device.deviceId
          }
        >
          {device.label}
        </option>
      ))}
    </select>
  )
}
