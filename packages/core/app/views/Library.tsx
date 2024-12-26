import React, { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { AutomergeUrl, isValidAutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import {
  MdEdit,
  MdOutlineMoreVert,
  MdOutlineRemoveCircleOutline,
  MdCheck,
} from 'react-icons/md'
import { Button } from '@tapes-monorepo/ui'
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
  const [recording] = useDocument<RecordingData>(automergeUrl)

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
          <Button
            className="p-1"
            title="Edit recording name"
            onClick={() => onOpenEditor()}
          >
            <p className="max-w-52 overflow-hidden text-ellipsis text-nowrap">
              {recording.name}
            </p>
            <MdEdit className="ml-2 opacity-0 transition-opacity ease-in group-hover:opacity-100" />
          </Button>
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
  const [hasErrors, setHasErrors] = useState(false)

  if (!recording) {
    return <div className="" />
  }

  return (
    <div className="flex size-full flex-col gap-2">
      <div className="flex justify-between">
        <EditableText
          text={recording.name}
          inputType="text"
          id="recording-name"
          name="recording-name"
          title="Edit recording name"
          onEdit={(newName) => {
            changeRecording((recording) => {
              recording.name = newName
            })
          }}
        >
          <p className="max-w-52 overflow-x-hidden text-ellipsis text-nowrap p-1">
            {recording.name}
          </p>
        </EditableText>
        <Button
          className="rounded-full p-2 hover:text-green-500 disabled:text-zinc-400 disabled:hover:bg-transparent"
          title="Save changes"
          disabled={hasErrors}
          onClick={() => !hasErrors && onClose()}
        >
          <MdCheck />
        </Button>
      </div>
      <div className="flex w-fit flex-col gap-2 text-xs">
        <EditableText
          text={recording.filename}
          inputType="text"
          id="recording-filename"
          name="recording-filename"
          title="Edit recording filename"
          onEdit={async (newName) => {
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
          validate={(value) => {
            const hasErrors = /[^a-z0-9\s_@()-]/i.test(value)
            setHasErrors(hasErrors)
            return hasErrors ? 'Invalid characters' : undefined
          }}
          hasErrors={hasErrors}
        >
          <p className="w-fit p-1">{recording.filename}</p>
        </EditableText>
      </div>
      <div className="flex flex-col gap-2 text-xs">
        <EditableText
          text={recording.description ?? ''}
          inputType="textarea"
          id="recording-description"
          name="recording-description"
          title="Edit recording description"
          onEdit={(value) =>
            changeRecording((recording) => {
              recording.description = value
            })
          }
        >
          <p className="size-full h-[5rem] overflow-y-auto whitespace-pre-line p-1">
            {(recording.description &&
              recording.description?.length > 0 &&
              recording.description) ||
              'Add a description'}
          </p>
        </EditableText>
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
  id,
  name,
  label,
  title,
  inputType,
  onEdit,
  hasErrors,
  validate,
  children,
}: {
  text: string
  id: string
  name: string
  inputType: 'text' | 'textarea'
  label?: string
  title?: string
  onEdit: (text: string) => void
  hasErrors?: boolean
  validate?: (text: string) => string | undefined
  children: React.ReactNode
}) {
  const previousTextRef = useRef(text)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedText, setEditedText] = useState(text)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!textAreaRef.current || !isEditing) {
      return
    }

    const cursorPosition = textAreaRef.current.value.length
    textAreaRef.current.setSelectionRange(cursorPosition, cursorPosition)
    textAreaRef.current.scrollBy(0, textAreaRef.current.scrollHeight)
  }, [isEditing])

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setError(undefined)

    if (typeof validate !== 'function') {
      setEditedText(event.target.value)
      onEdit(event.target.value)
      return
    }

    const error = validate(event.target.value)

    if (!error) {
      setEditedText(event.target.value)
      onEdit(event.target.value)
      return
    }

    setError(error)
    setEditedText(event.target.value)
  }

  return isEditing ? (
    <div className="flex flex-col justify-center">
      <label
        htmlFor={id}
        className={clsx(
          'bg-white text-sm transition-all peer-placeholder-shown:text-black dark:bg-zinc-900',
          {
            'text-zinc-400 peer-focus:text-zinc-400':
              error === undefined && label !== undefined,
            'h-0 translate-y-full opacity-0':
              error === undefined && label === undefined,
            'h-[1rem] translate-y-0 text-rose-500 opacity-100 peer-focus:text-rose-500':
              error !== undefined,
          },
        )}
      >
        {error ?? label}
      </label>
      {inputType === 'text' ? (
        <input
          type="text"
          className="peer w-full p-1 text-zinc-800 placeholder-transparent outline-none dark:bg-zinc-900 dark:text-white"
          name={name}
          id={id}
          defaultValue={editedText}
          autoFocus={true}
          onChange={handleChange}
          onBlur={() => {
            if (!editedText) {
              setEditedText(previousTextRef.current)
            }
            if (!hasErrors && editedText && editedText.length > 0) {
              onEdit(editedText)
              setIsEditing(false)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (!hasErrors && editedText && editedText.length > 0) {
                setIsEditing(false)
              }
            }
          }}
        />
      ) : (
        <textarea
          ref={textAreaRef}
          className="size-full h-[5rem] p-1 text-zinc-800 outline-none dark:bg-zinc-900 dark:text-white"
          autoFocus={true}
          id="description"
          name="description"
          defaultValue={text}
          rows={5}
          onChange={handleChange}
          onBlur={() => {
            if (!editedText) {
              setEditedText(previousTextRef.current)
            }
            if (!hasErrors) {
              onEdit(editedText)
            }
            setIsEditing(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (!hasErrors && editedText && editedText.length > 0) {
                onEdit(editedText)
              }
              setIsEditing(false)
            }
          }}
        />
      )}
    </div>
  ) : (
    <Button
      className="justify-start text-left"
      title={title}
      onClick={() => setIsEditing(true)}
    >
      {children}
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
