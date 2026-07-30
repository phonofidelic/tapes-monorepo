import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Repo } from '@automerge/automerge-repo'
import type { AppContextValue } from '@/context/AppContext'
import { App } from './App'

// The view tree below App is irrelevant here — these tests are about the seam
// between App and the shell that hands it a Repo — so collapse the providers
// and children to a marker.
vi.mock('./context/Providers', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}))

vi.mock('@/context/ViewContext', () => ({
  useView: () => ({ currentView: 'recorder', setCurrentView: vi.fn() }),
  navigationConfig: [],
  viewComponentMap: { recorder: null },
}))

vi.mock('./context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({ currentUrl: undefined }),
}))

vi.mock('./components/AudioPlayer', () => ({
  AudioPlayer: () => null,
}))

const appContextValue: AppContextValue = {
  type: 'web-client',
  worker: {} as unknown as Worker,
}

afterEach(() => {
  cleanup()
})

describe('App repo seam', () => {
  // Each shell builds its own Repo (storage and network adapters differ per
  // platform) and passes null until that bootstrap finishes.
  it('renders a loading state while the shell has no repo yet', () => {
    render(<App appContextValue={appContextValue} repoContextValue={null} />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByTestId('providers')).toBeNull()
  })

  it('renders the app tree once the shell provides a repo', () => {
    // A stub stands in for a real Repo: App only forwards it to Providers
    // (mocked above), and constructing one here would drag in Automerge's wasm.
    render(
      <App
        appContextValue={appContextValue}
        repoContextValue={{} as unknown as Repo}
      />,
    )

    expect(screen.getByTestId('providers')).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).toBeNull()
  })
})
