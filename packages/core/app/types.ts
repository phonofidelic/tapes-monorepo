import { AutomergeUrl } from '@automerge/automerge-repo'

export type RecordingData = {
  url: string
  filename: string
  filepath: string
  name: string
  id: string
}

export type RecordingRepoState = {
  recordings: AutomergeUrl[]
}
