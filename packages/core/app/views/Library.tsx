import { useSetting } from '@/context/SettingsContext'
import { isValidAutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { RecordingRepoState } from '@/types'

export function Library() {
  const [autoMergeUrl] = useSetting('automergeUrl')
  const [docState] = useDocument<RecordingRepoState>(
    isValidAutomergeUrl(autoMergeUrl) ? autoMergeUrl : undefined,
  )

  console.log('Library, autoMergeUrl:', autoMergeUrl)

  return (
    <div className="flex flex-col">
      <h1 className="">Library</h1>
      <ul>
        {docState?.recordings.map((url) => {
          return <li key={url}>{url}</li>
        })}
      </ul>
    </div>
  )
}
