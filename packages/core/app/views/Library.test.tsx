import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { AppContextProvider } from '@/context/AppContext'
import type { RecordingData, RecordingRepoState } from '@/types'
import { Library } from './Library'

const REPO_URL = 'automerge:repo' as AutomergeUrl
const RECORDING_URL = 'automerge:recording' as AutomergeUrl

const recording: RecordingData = {
  url: RECORDING_URL,
  filename: 'take-one.wav',
  filepath: '/recordings/take-one.wav',
  name: 'Take one',
  duration: 4,
  id: 'take-one',
}

// isValidAutomergeUrl gates whether Library passes the url to useDocument; the
// stub urls above aren't real Automerge urls, so force it true.
vi.mock('@automerge/automerge-repo', () => ({
  isValidAutomergeUrl: () => true,
}))

// One repo doc holding a single recording, and the recording doc itself.
// Branch on the url so both call sites (Library + LibraryListItem) resolve.
vi.mock('@automerge/automerge-repo-react-hooks', () => ({
  useDocument: (url?: AutomergeUrl) => {
    if (url === REPO_URL) {
      return [{ recordings: [RECORDING_URL] } as RecordingRepoState, vi.fn()]
    }
    return [recording, vi.fn()]
  },
}))

vi.mock('@/utils', () => ({
  useAutomergeUrl: () => ({ automergeUrl: REPO_URL }),
}))

vi.mock('@/context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    currentUrl: undefined,
    setCurrentSource: vi.fn(),
    setCurrentUrl: vi.fn(),
    setIsPlaying: vi.fn(),
  }),
}))

const renderLibrary = () =>
  render(
    <AppContextProvider
      value={{ type: 'web-client', worker: {} as unknown as Worker }}
    >
      <Library />
    </AppContextProvider>,
  )

describe('LibraryListItem controls visibility (touch vs mouse)', () => {
  beforeEach(() => {
    cleanup()
  })

  // Both controls the fix touched. On a fine-pointer (mouse) screen they stay
  // hidden until hover; on a screen with no fine pointer (touch) they must be
  // visible at rest — which is the bug the fix addresses.
  const controls = ['Options', 'Play recording'] as const

  it.each(controls)(
    'the %s button is forced visible where there is no fine pointer',
    (title) => {
      renderLibrary()
      expect(screen.getByTitle(title)).toHaveClass('pointer-none:opacity-100')
    },
  )

  it.each(controls)(
    'the %s button stays hover-revealed on fine-pointer devices',
    (title) => {
      renderLibrary()
      expect(screen.getByTitle(title)).toHaveClass('pointer-fine:opacity-0')
    },
  )

  it.each(controls)(
    'the %s button carries no unconditional opacity-0 (regression guard)',
    (title) => {
      renderLibrary()
      const classes = screen.getByTitle(title).className.split(/\s+/)
      expect(classes).not.toContain('opacity-0')
    },
  )
})
