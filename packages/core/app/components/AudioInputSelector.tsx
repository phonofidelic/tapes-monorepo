import { useState, useEffect } from 'react'
import { Button } from '@tapes-monorepo/ui'
import { useSetting } from '@/context/SettingsContext'
import clsx from 'clsx'
import { useAppContext } from '@/context/AppContext'
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
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
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
          const audioInputs = foundDevices
            .filter((device) => device.kind === 'audioinput')
            .filter((device) => device.deviceId !== 'default')
            .filter((device) => !device.label.match(/\(Virtual\)/))

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
