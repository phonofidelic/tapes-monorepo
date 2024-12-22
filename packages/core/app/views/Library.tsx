import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { AutomergeUrl, isValidAutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { MdEdit, MdOutlineMoreVert } from 'react-icons/md'
import { Button, TextInput } from '@tapes-monorepo/ui'
import { RecordingData, RecordingRepoState } from '@/types'
import { useSetting } from '@/context/SettingsContext'

export function Library() {
  const [autoMergeUrl] = useSetting('automergeUrl')
  const [docState] = useDocument<RecordingRepoState>(
    isValidAutomergeUrl(autoMergeUrl) ? autoMergeUrl : undefined,
  )

  return (
    <div className="flex flex-col">
      <ul>
        {docState?.recordings.map((url) => {
          return <LibraryListItem key={url} automergeUrl={url} />
        })}
      </ul>
    </div>
  )
}

function LibraryListItem({ automergeUrl }: { automergeUrl: AutomergeUrl }) {
  const [recording, changeRecording] = useDocument<RecordingData>(automergeUrl)

  const initialized = useRef(false)
  const previousRecordingName = useRef(recording?.name)
  const optionsMenuRef = useRef<HTMLDivElement | null>(null)

  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState(recording?.name)
  const [hasErrors, setHasErrors] = useState(false)

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
              'relative size-full flex-col gap-2 p-2 text-left transition-opacity ease-out',
            )}
          >
            <li className="size-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Button
                onClick={() => {
                  setIsOptionsMenuOpen(false)
                }}
              >
                Edit
              </Button>
            </li>
            <li className="size-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Button
                onClick={() => {
                  setIsOptionsMenuOpen(false)
                }}
              >
                Delete
              </Button>
            </li>
          </ul>
        </div>
      </div>
      <button
        title="Close menu"
        className={clsx(
          'absolute left-0 top-0 flex h-full w-screen bg-zinc-900 transition-opacity ease-in-out',
          {
            '-z-50 opacity-0': !isOptionsMenuOpen,
            'z-40 opacity-50': isOptionsMenuOpen,
          },
        )}
        onClick={() => setIsOptionsMenuOpen(false)}
      />
    </div>
  )
}
