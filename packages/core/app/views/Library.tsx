import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { AutomergeUrl, isValidAutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import {
  MdEdit,
  MdOutlineMoreVert,
  MdOutlineRemoveCircleOutline,
} from 'react-icons/md'
import { Button, TextInput } from '@tapes-monorepo/ui'
import { RecordingData, RecordingRepoState } from '@/types'
import { useSetting } from '@/context/SettingsContext'
import { useAppContext } from '@/context/AppContext'
import { IpcResponse } from '@/IpcService'

export function Library() {
  const [autoMergeUrl] = useSetting('automergeUrl')
  const [docState, changeDocState] = useDocument<RecordingRepoState>(
    isValidAutomergeUrl(autoMergeUrl) ? autoMergeUrl : undefined,
  )

  const deleteRecording = (url: AutomergeUrl) => {
    changeDocState((doc) => {
      doc.recordings = doc.recordings.filter(
        (recordingUrl) => recordingUrl !== url,
      )
    })
  }

  return (
    <div className="flex flex-col">
      <ul>
        {docState?.recordings.map((url) => {
          return (
            <LibraryListItem
              key={url}
              automergeUrl={url}
              onDelete={deleteRecording}
            />
          )
        })}
      </ul>
    </div>
  )
}

function LibraryListItem({
  automergeUrl,
  onDelete,
}: {
  automergeUrl: AutomergeUrl
  onDelete: (url: AutomergeUrl) => void
}) {
  const appContext = useAppContext()
  const [recording, changeRecording] = useDocument<RecordingData>(automergeUrl)

  const initialized = useRef(false)
  const previousRecordingName = useRef(recording?.name)
  const optionsMenuRef = useRef<HTMLDivElement | null>(null)

  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState(recording?.name)
  const [hasErrors, setHasErrors] = useState(false)

  const formattedDuration = useMemo(() => {
    if (!recording) {
      return ''
    }
    const minutes = Math.floor(recording.duration / 6000)
    const seconds = Math.floor(recording.duration % 6000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }, [recording])

  useEffect(() => {
    if (!recording || initialized.current) {
      return
    }

    previousRecordingName.current = recording.name
    setEditedName(recording.name)
    initialized.current = true
  }, [recording])

  if (!recording) {
    return null
  }

  return (
    <>
      <div className="group flex w-full justify-between p-4">
        {isEditing ? (
          <div className="w-full p-[7px]">
            <TextInput
              id="new-recording-name-input"
              name="new-recording-name"
              type="text"
              label="Edit recording name"
              defaultValue={editedName}
              autofocus={true}
              validate={(value) => {
                // TODO: update validation regex
                const hasErrors = /[^a-z0-9\s_@()-]/i.test(value)
                setHasErrors(hasErrors)
                return hasErrors ? 'Invalid characters' : undefined
              }}
              onChange={(event) => setEditedName(event.target.value)}
              onBlur={() => {
                if (!editedName) {
                  setEditedName(previousRecordingName.current)
                }
                setIsEditing(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (!hasErrors && editedName && editedName.length > 0) {
                    changeRecording((recording) => {
                      recording.name = editedName
                    })
                  }
                  setIsEditing(false)
                }
              }}
            />
          </div>
        ) : (
          <Button className="p-1" onClick={() => setIsEditing(true)}>
            <p className="max-w-52 overflow-hidden text-ellipsis text-nowrap">
              {recording.name}
            </p>
            <MdEdit className="ml-2 opacity-0 transition-opacity ease-in group-hover:opacity-100" />
          </Button>
        )}
        <div className="flex gap-2">
          <p className="flex items-center text-xs text-zinc-400">
            <FormattedTime time={recording.duration} />
          </p>
          <div ref={optionsMenuRef} className="relative">
            <Button
              title="Options"
              className={clsx(
                'rounded-full p-2 opacity-0 transition-opacity ease-in group-hover:opacity-100',
                {
                  'opacity-100': isOptionsMenuOpen,
                },
              )}
              onClick={() => setIsOptionsMenuOpen(!isOptionsMenuOpen)}
            >
              <MdOutlineMoreVert />
            </Button>
            <div
              className={clsx('absolute top-0 z-50', {
                'hidden opacity-0': !isOptionsMenuOpen,
                'flex opacity-100': isOptionsMenuOpen,
              })}
              style={{
                right: `${optionsMenuRef.current?.getBoundingClientRect().width ?? 0}px`,
              }}
            >
              <ul
                className={clsx(
                  'relative size-full flex-col gap-2 rounded-md bg-white p-1 text-left shadow-lg transition-opacity ease-out dark:bg-zinc-900',
                  {
                    'opacity-0': !isOptionsMenuOpen,
                    'opacity-100': isOptionsMenuOpen,
                  },
                )}
              >
                <li className="size-full rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <Button
                    className="flex gap-2"
                    onClick={() => {
                      setIsOptionsMenuOpen(false)
                    }}
                  >
                    <MdEdit /> Edit
                  </Button>
                </li>
                {appContext.type === 'electron-client' && (
                  <li className="size-full rounded p-2 hover:bg-zinc-100 hover:text-rose-500 dark:hover:bg-zinc-800">
                    <Button
                      className="flex gap-2"
                      onClick={async () => {
                        const deleteRecordingResponse =
                          await appContext.ipc.send<IpcResponse>(
                            'storage:delete-recording',
                            {
                              data: { filepath: recording.filepath },
                            },
                          )
                        if (deleteRecordingResponse.error) {
                          console.error(deleteRecordingResponse.error)
                          setIsOptionsMenuOpen(false)
                          return
                        }
                        onDelete(automergeUrl)
                        setIsOptionsMenuOpen(false)
                      }}
                    >
                      <MdOutlineRemoveCircleOutline /> Delete
                    </Button>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
      <button
        title={isOptionsMenuOpen ? 'Close menu' : ''}
        className={clsx(
          'absolute left-0 top-0 flex h-full w-screen bg-white transition-opacity ease-in-out dark:bg-zinc-900',
          {
            'hidden opacity-0': !isOptionsMenuOpen,
            'z-40 opacity-50': isOptionsMenuOpen,
          },
        )}
        onClick={() => setIsOptionsMenuOpen(false)}
      />
    </>
  )
}

function FormattedTime({ time }: { time: number }) {
  // const centiseconds = ('0' + (Math.floor(time / 10) % 100)).slice(-2)
  const seconds = ('0' + (Math.floor(time / 1000) % 60)).slice(-2)
  const minutes = ('0' + (Math.floor(time / 60000) % 60)).slice(-2)
  const hours = ('0' + Math.floor(time / 3600000)).slice(-2)

  return `${hours}:${minutes}:${seconds}`
}
