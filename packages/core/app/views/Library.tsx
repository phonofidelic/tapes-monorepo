import { useSetting } from '@/context/SettingsContext'
import { AutomergeUrl, isValidAutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { RecordingData, RecordingRepoState } from '@/types'
import { Button, TextInput } from '@tapes-monorepo/ui'
import { MdEdit } from 'react-icons/md'
import { useEffect, useRef, useState } from 'react'

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
    <div className="group w-full p-4">
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
          <MdEdit className="ml-2 opacity-0 transition-opacity delay-75 ease-in group-hover:opacity-100" />
        </Button>
      )}
    </div>
  )
}
