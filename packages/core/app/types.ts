import { AutomergeUrl } from '@automerge/automerge-repo'

export type RecordingData = {
  url: AutomergeUrl
  filename: string
  filepath: string
  name: string
  description?: string
  duration: number
  id: string
}

export type RecordingRepoState = {
  recordings: AutomergeUrl[]
}
