import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { use, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PortalsProvider, usePortals } from './context/PortalsContext'
import { App } from './App'

// App is layout only: the shell supplies the providers, and the views are
// swapped per test through this map.
const views = vi.hoisted(() => ({
  current: 'recorder' as 'recorder' | 'library' | 'settings',
  map: {} as Record<string, React.ReactNode>,
}))

vi.mock('@/context/ViewContext', () => ({
  useView: () => ({ currentView: views.current, setCurrentView: vi.fn() }),
  navigationConfig: [
    { label: 'Record', view: 'recorder' },
    { label: 'Library', view: 'library' },
  ],
  get viewComponentMap() {
    return views.map
  },
}))

const renderApp = (view: React.ReactNode = <p>recorder view</p>) => {
  views.map = { [views.current]: view }
  return render(
    <PortalsProvider>
      <App />
    </PortalsProvider>,
  )
}

afterEach(() => {
  cleanup()
  views.current = 'recorder'
  vi.restoreAllMocks()
})

describe('App views', () => {
  it('renders the current view inside main', () => {
    const { container } = renderApp()

    expect(container.querySelector('main')).toHaveTextContent('recorder view')
  })

  it('shows a loader naming the view while it suspends', () => {
    views.current = 'library'
    const never = new Promise<never>(() => {})
    function Suspending() {
      use(never)
      return null
    }

    renderApp(<Suspending />)

    expect(screen.getByText('Loading library...')).toBeInTheDocument()
  })

  it('keeps the navigation when a view throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken(): React.ReactNode {
      throw new Error('view failed')
    }

    const { container } = renderApp(<Broken />)

    expect(screen.getByText('Something went wrong...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(container.querySelector('nav')).not.toBeNull()
  })
})

// Above `md` the fine-pointer nav becomes a sidebar to the left of main.
// Below it, the nav sits above main as a bar of tabs.
describe('App desktop layout', () => {
  it('puts the nav beside main above the breakpoint', () => {
    const { container } = renderApp()

    const main = container.querySelector('main')!
    const row = main.parentElement!
    expect(row).toHaveClass('max-md:flex-col')
    expect(row).toHaveClass('md:flex-row')

    // The fine-pointer nav is the first child of the same row, before main.
    const topNav = row.querySelector('nav')!
    expect(row.firstElementChild).toContainElement(topNav)
    expect(
      topNav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('lets main fill its row and scroll itself', () => {
    const { container } = renderApp()

    const main = container.querySelector('main')
    expect(main).toHaveClass('w-full')
    expect(main).toHaveClass('h-full')
    expect(main).toHaveClass('overflow-y-auto')
    // The Recorder view positions its visualizer `absolute` against main.
    expect(main).toHaveClass('relative')
    expect(main).not.toHaveClass('fixed')
    expect(main).not.toHaveClass('max-w-3xl')
  })

  it('centres the tabs below the breakpoint and stacks them above it', () => {
    const { container } = renderApp()

    // One nav for fine pointers beside main, one for touch in the dock.
    const navs = container.querySelectorAll('nav')
    expect(navs).toHaveLength(2)
    for (const nav of navs) {
      expect(nav).not.toHaveClass('max-w-3xl')

      const list = nav.querySelector('ul')
      expect(list).toHaveClass('max-w-3xl')
      expect(list).toHaveClass('mx-auto')
      expect(list).toHaveClass('md:mx-0')
      // Only the fine-pointer sidebar stacks. The touch nav stays a row in
      // the dock, even on tablets wider than the breakpoint.
      expect(list).toHaveClass('md:not-pointer-coarse:flex-col')
      expect(list).not.toHaveClass('md:flex-col')
    }
  })
})

// The dock below main holds the editor panel above the player bar, so neither
// has to be positioned over the other.
describe('App dock', () => {
  function DockProbe() {
    const { container: editor } = usePortals('editorPortal')
    const { container: player } = usePortals('audioPlayerPortal')
    // The slots register after App mounts, so ask again once they have.
    const [, rerender] = useState(0)
    useEffect(() => rerender(1), [])
    return (
      <>
        {editor && createPortal(<p>editor panel</p>, editor)}
        {player && createPortal(<p>player bar</p>, player)}
      </>
    )
  }

  it('stacks the editor slot above the player slot, below main', async () => {
    const { container } = renderApp(<DockProbe />)

    const editor = await screen.findByText('editor panel')
    const player = await screen.findByText('player bar')
    const main = container.querySelector('main')!

    expect(
      main.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      editor.compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(main).not.toContainElement(editor)
  })
})
