import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { AutomergeUrl, isValidAutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import {
  MdEdit,
  MdOutlineMoreVert,
  MdOutlineRemoveCircleOutline,
  MdCheck,
} from 'react-icons/md'
import { Button, TextInput } from '@tapes-monorepo/ui'
import { RecordingData, RecordingRepoState } from '@/types'
import { useSetting } from '@/context/SettingsContext'
import { useAppContext } from '@/context/AppContext'
import { EditRecordingResponse, IpcResponse } from '@/IpcService'

export function Library() {
  const [autoMergeUrl] = useSetting('automergeUrl')
  const [docState, changeDocState] = useDocument<RecordingRepoState>(
    isValidAutomergeUrl(autoMergeUrl) ? autoMergeUrl : undefined,
  )

  const [editingUrl, setEditingUrl] = useState<AutomergeUrl | null>(null)

  const deleteRecording = (url: AutomergeUrl) => {
    changeDocState((doc) => {
      doc.recordings = doc.recordings.filter(
        (recordingUrl) => recordingUrl !== url,
      )
    })
  }

  return (
    <>
      <div className="flex flex-col">
        <ul>
          {docState?.recordings.map((url) => {
            return (
              <LibraryListItem
                key={url}
                automergeUrl={url}
                onDelete={deleteRecording}
                onOpenEditor={() => {
                  setEditingUrl(url)
                }}
              />
            )
          })}
        </ul>
      </div>
      <div
        className={clsx(
          'absolute bottom-0 left-0 z-50 w-screen rounded-t-lg border-zinc-100 bg-white transition-transform dark:border-zinc-800 dark:bg-zinc-900',
          {
            'translate-y-0 border p-5 drop-shadow-2xl': editingUrl,
            'translate-y-full p-0': !editingUrl,
          },
        )}
      >
        <Editor automergeUrl={editingUrl} onClose={() => setEditingUrl(null)} />
      </div>
      <Backdrop
        title="Close editor"
        isOpen={editingUrl !== null}
        onClose={() => setEditingUrl(null)}
      />
    </>
  )
}

function LibraryListItem({
  automergeUrl,
  onDelete,
  onOpenEditor,
}: {
  automergeUrl: AutomergeUrl
  onDelete: (url: AutomergeUrl) => void
  onOpenEditor: () => void
}) {
  const appContext = useAppContext()
  const [recording, changeRecording] = useDocument<RecordingData>(automergeUrl)

  const initialized = useRef(false)
  const previousRecordingName = useRef(recording?.name)
  const optionsMenuRef = useRef<HTMLDivElement | null>(null)

  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false)
  const [, setEditedName] = useState(recording?.name)

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
        <span className="has-[button]:hover:shadow-sm">
          <EditableText
            text={recording.name}
            label="Edit recording name"
            onChange={(newName) => {
              changeRecording((recording) => {
                recording.name = newName
              })
            }}
          />
        </span>
        <div className="flex gap-2">
          <p className="flex items-center text-xs text-zinc-400">
            <FormattedTime time={recording.duration} />
          </p>
          <div ref={optionsMenuRef} className="relative">
            <Button
              title="Options"
              className={clsx(
                'rounded-full bg-none p-2 opacity-0 transition-opacity ease-in hover:bg-none hover:shadow-sm group-hover:opacity-100',
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
                <li>
                  <Button
                    className="flex size-full gap-2 rounded p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={() => {
                      setIsOptionsMenuOpen(false)
                      onOpenEditor()
                    }}
                  >
                    <MdEdit /> Edit
                  </Button>
                </li>
                {appContext.type === 'electron-client' && (
                  <li>
                    <Button
                      className="flex size-full gap-2 rounded p-2 hover:bg-zinc-100 hover:text-rose-500 dark:hover:bg-zinc-800"
                      onClick={async () => {
                        const deleteRecordingResponse =
                          await appContext.ipc.send<IpcResponse>(
                            'storage:delete-recording',
                            {
                              data: { filepath: recording.filepath },
                            },
                          )
                        if (!deleteRecordingResponse.success) {
                          console.error(deleteRecordingResponse.error)
                          if (
                            !deleteRecordingResponse.error.message.includes(
                              'ENOENT',
                            )
                          ) {
                            setIsOptionsMenuOpen(false)
                            return
                          }
                          // If the file doesn't exist, remove it from the list
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
      <Backdrop
        title="Close menu"
        isOpen={isOptionsMenuOpen}
        onClose={() => setIsOptionsMenuOpen(false)}
      />
    </>
  )
}

function Editor({
  automergeUrl,
  onClose,
}: {
  automergeUrl: AutomergeUrl | null
  onClose: () => void
}) {
  const appContext = useAppContext()
  const [recording, changeRecording] = useDocument<RecordingData>(
    automergeUrl ?? undefined,
  )

  if (!recording) {
    return <div className="" />
  }

  return (
    <div className="flex size-full flex-col gap-2">
      <div className="flex justify-between gap-1">
        <EditableText
          text={recording.name}
          label="Edit recording name"
          onChange={(newName) => {
            changeRecording((recording) => {
              recording.name = newName
            })
          }}
        />
        <Button
          className="rounded-full p-2 hover:text-green-500"
          onClick={() => onClose()}
        >
          <MdCheck />
        </Button>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <div className="p-1">Filename:</div>
        <EditableText
          text={recording.filename}
          label="Edit recording filename"
          onChange={async (newName) => {
            if (appContext.type !== 'electron-client') {
              return
            }
            const editFilenameResponse =
              await appContext.ipc.send<EditRecordingResponse>(
                'storage:edit-recording',
                { data: { filename: newName, filepath: recording.filepath } },
              )
            if (!editFilenameResponse.success) {
              console.error(editFilenameResponse.error)
              return
            }
            changeRecording((recording) => {
              recording.filename = newName
              recording.filepath = editFilenameResponse.data.filepath
            })
          }}
        />
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <div className="p-1">Description:</div>
        <textarea
          className="p-2 text-zinc-800 dark:bg-zinc-900 dark:text-white"
          id="description"
          name="description"
          // value={recording.description}
          defaultValue={recording.description}
          rows={5}
          onChange={(event) => {
            changeRecording((recording) => {
              recording.description = event.target.value
            })
          }}
        />
      </div>
    </div>
  )
}

function FormattedTime({ time }: { time: number }) {
  // const centiseconds = ('0' + (Math.floor(time / 10) % 100)).slice(-2)
  const seconds = ('0' + (Math.floor(time / 1000) % 60)).slice(-2)
  const minutes = ('0' + (Math.floor(time / 60000) % 60)).slice(-2)
  const hours = ('0' + Math.floor(time / 3600000)).slice(-2)

  return `${hours}:${minutes}:${seconds}`
}

function EditableText({
  text,
  label,
  onChange,
}: {
  text: string
  label: string
  onChange: (text: string) => void
}) {
  const previousTextRef = useRef(text)
  const [isEditing, setIsEditing] = useState(false)
  const [editedText, setEditedText] = useState(text)
  const [hasErrors, setHasErrors] = useState(false)

  return isEditing ? (
    <div className="w-full p-[7px]">
      <TextInput
        id="new-recording-name-input"
        name="new-recording-name"
        type="text"
        label={label}
        defaultValue={editedText}
        autofocus={true}
        validate={(value) => {
          // TODO: update validation regex
          const hasErrors = /[^a-z0-9\s_@()-]/i.test(value)
          setHasErrors(hasErrors)
          return hasErrors ? 'Invalid characters' : undefined
        }}
        onChange={(event) => setEditedText(event.target.value)}
        onBlur={() => {
          if (!editedText) {
            setEditedText(previousTextRef.current)
          }
          if (!hasErrors && editedText && editedText.length > 0) {
            onChange(editedText)
          }
          setIsEditing(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            if (!hasErrors && editedText && editedText.length > 0) {
              onChange(editedText)
            }
            setIsEditing(false)
          }
        }}
      />
    </div>
  ) : (
    <Button className="p-1" onClick={() => setIsEditing(true)}>
      <p className="max-w-52 overflow-hidden text-ellipsis text-nowrap">
        {text}
      </p>
      <MdEdit className="ml-2 opacity-0 transition-opacity ease-in group-hover:opacity-100" />
    </Button>
  )
}

function Backdrop({
  isOpen,
  title = 'Close',
  onClose,
}: {
  isOpen: boolean
  title?: string
  onClose: () => void
}) {
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onEscape)

    return () => {
      document.removeEventListener('keydown', onEscape)
    }
  }, [])

  return (
    <button
      title={isOpen ? title : ''}
      className={clsx(
        'absolute left-0 top-0 flex h-full w-screen bg-white transition-opacity ease-in-out dark:bg-zinc-900',
        {
          'hidden opacity-0': !isOpen,
          'z-40 opacity-50': isOpen,
        },
      )}
      onClick={() => onClose()}
    />
  )
}
