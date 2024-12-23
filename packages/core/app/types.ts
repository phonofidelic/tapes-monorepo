import { AutomergeUrl } from '@automerge/automerge-repo'

export type RecordingData = {
  url: string
  filename: string
  filepath: string
  name: string
  duration: number
  id: string
}

export type RecordingRepoState = {
  recordings: AutomergeUrl[]
}
