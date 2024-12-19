import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { AiFillAudio, AiOutlineAudioMuted } from 'react-icons/ai'
import { MdOutlineCancel, MdEdit, MdCheck } from 'react-icons/md'
import { PiRecordFill } from 'react-icons/pi'
import { Button } from '@tapes-monorepo/ui'
import { AudioInputSelector } from '@/components/AudioInputSelector'
import { useSetting } from '@/context/SettingsContext'
import { AudioVisualizer } from '@/components/AudioVisualizer'
import { getAudioStream } from '@/utils'
import { useAppContext } from '@/context/AppContext'
import { useRecordingState } from '@/context/RecordingContext'
import { IpcResponse, StopRecordingResponse } from '@/IpcService'

const NEW_RECORDING_DEFAULT_NAME = 'New recording'

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
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState(NEW_RECORDING_DEFAULT_NAME)
  const [filepath, setFilepath] = useState('')
  const [hasErrors, setHasErrors] = useState(false)

  const commitFileChange = ({ filename }: { filename: string }) => {
    if (appContext.type !== 'electron-client') {
      return
    }

    if (hasErrors) {
      // TODO: add error feedback
      return
    }

    if (!editedName) {
      setEditedName(NEW_RECORDING_DEFAULT_NAME)
    }

    appContext.ipc.send('storage:edit-recording', {
      data: {
        filename,
        filepath,
      },
    })
    setIsEditing(false)
    setIsEditorOpen(false)
    setEditedName(NEW_RECORDING_DEFAULT_NAME)
    setFilepath('')
  }

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
          'absolute bottom-[79px] left-0 right-0 w-screen rounded-t-lg border border-zinc-100 bg-white text-zinc-400 drop-shadow-2xl transition-transform dark:border-zinc-800 dark:bg-zinc-900',
          {
            'translate-y-0': isEditorOpen,
            'translate-y-full': !isEditorOpen,
          },
        )}
      >
        <div className="group flex size-full items-center justify-between gap-2 p-4">
          {isEditing ? (
            <div className="w-full p-[7px]">
              <TextInput
                id="new-recording-name-input"
                name="new-recording-name"
                type="text"
                label="Name your new recording"
                defaultValue={editedName}
                autofocus={true}
                validate={(value) => {
                  const hasErrors = /[^a-z0-9\s_@()-]/i.test(value)
                  setHasErrors(hasErrors)
                  return hasErrors ? 'Invalid characters' : undefined
                }}
                onChange={(event) => setEditedName(event.target.value)}
                onBlur={() => {
                  if (!editedName) {
                    setEditedName(NEW_RECORDING_DEFAULT_NAME)
                  }
                  setIsEditing(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitFileChange({ filename: editedName })
                  }
                }}
              />
            </div>
          ) : (
            <>
              <Button
                title="Delete recording"
                className="rounded-full p-4 hover:text-rose-500"
                onClick={() => {
                  console.log('TODO: delete recording')
                  setIsEditorOpen(false)
                }}
              >
                <MdOutlineCancel />
              </Button>
              <Button
                className="flex p-4"
                title={`Rename ${editedName}`}
                onClick={() => setIsEditing(true)}
              >
                <p className="max-w-52 overflow-hidden text-ellipsis text-nowrap">
                  {editedName}
                </p>
                <MdEdit className="ml-2 opacity-0 transition-opacity delay-75 ease-in group-hover:opacity-100" />
              </Button>
              <Button
                title="Save recoding"
                className="rounded-full p-4 hover:text-green-500"
                onClick={() => commitFileChange({ filename: editedName })}
              >
                <MdCheck />
              </Button>
            </>
          )}
        </div>
      </div>
      <div
        className={clsx(
          'absolute bottom-0 left-0 z-10 w-full border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900',
          {
            'border-t': !isMonitoring || feature !== 'frequency',
          },
        )}
      >
        <div className="flex h-20 w-full items-center justify-center">
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
                  disabled={isEditorOpen}
                  onClick={async () => {
                    console.groupCollapsed('* click *')
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
                      const stopResponse =
                        await appContext.ipc.send<StopRecordingResponse>(
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

                      setFilepath(stopResponse.data.filepath)
                      setIsEditorOpen(true)
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
      </div>
    </>
  )
}

function TextInput({
  value,
  defaultValue,
  id,
  type,
  name,
  label,
  autofocus,
  validate,
  onChange,
  onBlur,
  onKeyDown,
}: {
  id: string
  type: 'text' | 'email' | 'password'
  name: string
  label: string
  autofocus?: boolean
  value?: string
  defaultValue?: string
  validate?: (value: string) => string | undefined
  onChange?(event: React.ChangeEvent<HTMLInputElement>): void
  onBlur?(event: React.FocusEvent<HTMLInputElement>): void
  onKeyDown?(event: React.KeyboardEvent<HTMLInputElement>): void
}) {
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <div className="relative w-full">
      <input
        value={value}
        defaultValue={defaultValue}
        id={id}
        name={name}
        type={type}
        autoFocus={autofocus}
        placeholder={label}
        onChange={(event) => {
          setError(undefined)

          if (typeof onChange !== 'function') {
            return
          }

          if (typeof validate !== 'function') {
            onChange(event)
            return
          }

          const error = validate(event.target.value)

          if (!error) {
            onChange(event)
            return
          }

          setError(error)
          onChange(event)
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={clsx(
          'peer w-full rounded p-2 text-zinc-800 placeholder-transparent outline-none dark:bg-zinc-900 dark:text-white',
          {
            'outline-zinc-400': error === undefined,
            'outline-rose-500': error !== undefined,
          },
        )}
      />
      <label
        htmlFor={id}
        className={clsx(
          'absolute -top-4 left-2 bg-white p-1 text-sm transition-all peer-placeholder-shown:top-2 peer-placeholder-shown:p-0 peer-placeholder-shown:text-base peer-placeholder-shown:text-black peer-focus:-top-4 peer-focus:p-1 peer-focus:text-sm dark:bg-zinc-900',
          {
            'text-zinc-400 peer-focus:text-zinc-400': error === undefined,
            'text-rose-500 peer-focus:text-rose-500': error !== undefined,
          },
        )}
      >
        {error ?? label}
      </label>
    </div>
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
