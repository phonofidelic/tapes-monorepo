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
    const { container } = render(
      <App appContextValue={appContextValue} repoContextValue={null} />,
    )

    // The nav renders either way; only the views wait for the repo.
    expect(screen.getByText('Loading repo...')).toBeInTheDocument()
    expect(container.querySelector('nav')).not.toBeNull()
    expect(container.querySelector('main')).toBeNull()
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
    expect(screen.queryByText('Loading repo...')).toBeNull()
  })
})

// `main` carries the column itself rather than an inner wrapper because the
// Recorder view positions its visualizer and name editor `absolute` against it.
describe('App desktop layout', () => {
  it('holds main to a centred max-width column above the breakpoint', () => {
    const { container } = render(
      <App
        appContextValue={appContextValue}
        repoContextValue={{} as unknown as Repo}
      />,
    )

    const main = container.querySelector('main')
    expect(main).not.toBeNull()
    // Gated on `sm`, so the mobile layout stays full-bleed.
    expect(main).toHaveClass('sm:max-w-3xl')
    expect(main).toHaveClass('sm:mx-auto')
    // Main is the scrolling child of the flex column, not pinned to the viewport.
    expect(main).toHaveClass('flex-1')
    expect(main).toHaveClass('overflow-y-auto')
    expect(main).not.toHaveClass('fixed')
  })

  it('keeps the nav bar full-bleed while centring its tabs', () => {
    const { container } = render(
      <App
        appContextValue={appContextValue}
        repoContextValue={{} as unknown as Repo}
      />,
    )

    // The bar keeps its background and border spanning the window...
    const nav = container.querySelector('nav')
    expect(nav).not.toBeNull()
    expect(nav).not.toHaveClass('max-w-3xl')

    // ...while the tabs inside follow main's column.
    const list = container.querySelector('nav ul')
    expect(list).not.toBeNull()
    expect(list).toHaveClass('max-w-3xl')
    expect(list).toHaveClass('mx-auto')
  })
})
