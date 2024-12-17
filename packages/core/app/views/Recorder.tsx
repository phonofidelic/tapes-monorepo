import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { AiFillAudio, AiOutlineAudioMuted } from 'react-icons/ai'
import { PiRecordFill } from 'react-icons/pi'
import { Button } from '@tapes-monorepo/ui'
import { AudioInputSelector } from '@/AudioInputSelector'
import { useSettings } from '@/context/SettingsContext'
import { AudioVisualizer } from '@/components/AudioVisualizer'
import { getAudioStream } from '@/utils'

export function Recorder() {
  const { audioInputDeviceId } = useSettings()
  const { isMonitoring, setIsMonitoring } = useMonitor(audioInputDeviceId)
  const [isRecording, setIsRecording] = useState(false)
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
              disabled={!audioInputDeviceId}
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
            <Button
              title={isRecording ? 'Stop recording' : 'Start recording'}
              className="group relative flex size-full justify-center p-4 text-xs"
              onClick={() => setIsRecording(!isRecording)}
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
          </>
        ) : (
          <AudioInputSelector className="size-full p-6" />
        )}
      </div>
    </>
  )
}

function Timer() {
  const [time, setTime] = useState(0)

  const centiseconds = ('0' + (Math.floor(time / 10) % 100)).slice(-2)
  const seconds = ('0' + (Math.floor(time / 1000) % 60)).slice(-2)
  const minutes = ('0' + (Math.floor(time / 60000) % 60)).slice(-2)
  const hours = ('0' + Math.floor(time / 3600000)).slice(-2)

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      setTime(Date.now() - start)
    }, 10)
    return () => {
      clearInterval(interval)
    }
  }, [])

  return (
    <div>
      {hours}:{minutes}:{seconds}:{centiseconds}
    </div>
  )
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
