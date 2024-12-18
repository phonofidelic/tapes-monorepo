import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { AiFillAudio, AiOutlineAudioMuted } from 'react-icons/ai'
import { PiRecordFill } from 'react-icons/pi'
import { Button } from '@tapes-monorepo/ui'
import { AudioInputSelector } from '@/components/AudioInputSelector'
import { useSetting } from '@/context/SettingsContext'
import { AudioVisualizer } from '@/components/AudioVisualizer'
import { getAudioStream } from '@/utils'
import { useAppContext } from '@/context/AppContext'
import { useRecordingState } from '@/context/RecordingContext'
import { IpcResponse } from '@/IpcService'

export function Recorder() {
  const appContext = useAppContext()
  const [audioInputDeviceId] = useSetting('audioInputDeviceId')
  const [storageLocation, setStorageLocation] = useSetting('storageLocation')
  const { isMonitoring, setIsMonitoring } = useMonitor(audioInputDeviceId)
  const { time, isRecording, setIsRecording } = useRecordingState()
  const visualizerContainerRef = useRef<HTMLDivElement | null>(null)

  const [feature, setFeature] = useState<'frequency' | 'time-domain'>(
    'frequency',
  )

  return (
    <>
      <div className="flex h-full flex-col pb-20">
        <div
          ref={visualizerContainerRef}
          className="absolute bottom-[79px] left-0 right-0 top-0"
        >
          {audioInputDeviceId && isMonitoring && (
            <>
              <div className="absolute top-0 z-50 flex w-full justify-end gap-1 p-4 text-xs">
                <p className="p-1 text-zinc-400">Visualization:</p>
                <Button
                  className={clsx('rounded border p-1 dark:border-zinc-800', {
                    'bg-zinc-100 dark:bg-zinc-800': feature === 'frequency',
                    'text-zinc-400': feature !== 'frequency',
                  })}
                  disabled={feature === 'frequency'}
                  onClick={() => setFeature('frequency')}
                >
                  frequency
                </Button>
                <Button
                  className={clsx('rounded border p-1 dark:border-zinc-800', {
                    'bg-zinc-100 dark:bg-zinc-800': feature === 'time-domain',
                    'text-zinc-400': feature !== 'time-domain',
                  })}
                  disabled={feature === 'time-domain'}
                  onClick={() => setFeature('time-domain')}
                >
                  time-domain
                </Button>
              </div>
              <AudioVisualizer
                audioInputDeviceId={audioInputDeviceId}
                feature={feature}
                containerRef={visualizerContainerRef}
              />
            </>
          )}
        </div>
      </div>
      <div
        className={clsx(
          'absolute bottom-0 left-0 z-10 flex h-20 w-full items-center justify-center border-zinc-100 dark:border-zinc-800',
          {
            'border-t': !isMonitoring || feature !== 'frequency',
          },
        )}
      >
        {audioInputDeviceId ? (
          <>
            <Button
              className="group relative flex size-full justify-center p-4 text-xs"
              title={isMonitoring ? 'Turn off monitor' : 'Turn on monitor'}
              onClick={() => {
                setIsMonitoring(!isMonitoring)
              }}
            >
              {isMonitoring && (
                <div className="absolute left-0 top-0 flex w-full p-2 text-rose-500">
                  Monitoring
                </div>
              )}

              <div className="text-xl text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-white">
                {!isMonitoring ? (
                  <AiFillAudio />
                ) : (
                  <AiOutlineAudioMuted className="dark:text-white" />
                )}
              </div>
            </Button>
            {storageLocation ? (
              <Button
                title={isRecording ? 'Stop recording' : 'Start recording'}
                className="group relative flex size-full justify-center p-4 text-xs"
                onClick={async () => {
                  if (appContext.type !== 'electron-client') {
                    return
                  }

                  if (!isRecording) {
                    setIsRecording(true)
                    const startResponse =
                      await appContext.ipc.send<IpcResponse>('recorder:start')
                    console.log('startResponse:', startResponse)
                    if (!startResponse.success) {
                      setIsRecording(false)
                      // TODO: Handle error
                      console.error(startResponse.error)
                      return
                    }
                    return
                  }

                  if (isRecording) {
                    setIsRecording(false)
                    const stopResponse = await appContext.ipc.send<IpcResponse>(
                      'recorder:stop',
                      {
                        data: { storageLocation, duration: time },
                      },
                    )
                    console.log('stopResponse:', stopResponse)

                    if (!stopResponse.success) {
                      // TODO: Handle error
                      console.error(stopResponse.error)
                    }

                    return
                    // TODO: Show set recording name dialog
                  }
                }}
              >
                {isRecording && (
                  <div className="absolute right-0 top-0 flex p-2 text-xs text-rose-500">
                    <Timer />
                  </div>
                )}
                <PiRecordFill
                  className={clsx('text-xl', {
                    'text-rose-500': isRecording,
                    'text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-white':
                      !isRecording,
                  })}
                />
              </Button>
            ) : appContext.type === 'electron-client' ? (
              <Button
                title={isRecording ? 'Stop recording' : 'Start recording'}
                className="group relative flex size-full justify-center p-4 text-xs"
                onClick={async () => {
                  const response = (await appContext.ipc.send(
                    'storage:open-directory-dialog',
                  )) as string | undefined

                  if (!response) {
                    console.error(
                      'No response from storage:open-directory-dialog',
                    )
                    return
                  }

                  if (response === '__unset__') {
                    return
                  }

                  setStorageLocation(response)
                }}
              >
                Select a storage location
              </Button>
            ) : null}
          </>
        ) : (
          <AudioInputSelector className="size-full p-6" />
        )}
      </div>
    </>
  )
}

function Timer() {
  const { time } = useRecordingState()

  const centiseconds = ('0' + (Math.floor(time / 10) % 100)).slice(-2)
  const seconds = ('0' + (Math.floor(time / 1000) % 60)).slice(-2)
  const minutes = ('0' + (Math.floor(time / 60000) % 60)).slice(-2)
  const hours = ('0' + Math.floor(time / 3600000)).slice(-2)

  return `${hours}:${minutes}:${seconds}:${centiseconds}`
}

function useMonitor(selectedMediaDeviceId: string | null) {
  const [isMonitoring, setIsMonitoring] = useState(false)

  useEffect(() => {
    if (!selectedMediaDeviceId) {
      return
    }

    const audioCtx = new window.AudioContext()

    getAudioStream(selectedMediaDeviceId).then((audioStream) => {
      if (audioCtx.state === 'closed') return

      const sourceNode = audioCtx.createMediaStreamSource(audioStream)
      if (isMonitoring) {
        sourceNode.connect(audioCtx.destination)
      }
    })

    return () => {
      audioCtx.close()
    }
  }, [isMonitoring])

  return {
    isMonitoring,
    setIsMonitoring,
  }
}
