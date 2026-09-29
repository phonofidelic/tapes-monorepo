import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { PortalContainer, PortalsProvider, usePortals } from './PortalsContext'

function Portalled({ slot, text }: { slot: string; text: string }) {
  const { container } = usePortals(slot)
  return container ? createPortal(<p>{text}</p>, container) : null
}

/** Mounts its children only once asked, after the slots have registered. */
function Later({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false)
  return (
    <>
      <button onClick={() => setShown(true)}>show</button>
      {shown && children}
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PortalsContext', () => {
  it('renders a consumer’s content into the slot with its key', () => {
    render(
      <PortalsProvider>
        <div data-testid="a">
          <PortalContainer containerRefKey="a" />
        </div>
        <div data-testid="b">
          <PortalContainer containerRefKey="b" />
        </div>
        <Later>
          <Portalled slot="a" text="first" />
          <Portalled slot="b" text="second" />
        </Later>
      </PortalsProvider>,
    )

    act(() => screen.getByText('show').click())

    expect(screen.getByTestId('a')).toHaveTextContent('first')
    expect(screen.getByTestId('b')).toHaveTextContent('second')
  })

  it('gives a consumer no container for a key no slot has registered', () => {
    render(
      <PortalsProvider>
        <PortalContainer containerRefKey="a" />
        <Later>
          <Portalled slot="missing" text="orphan" />
        </Later>
      </PortalsProvider>,
    )

    act(() => screen.getByText('show').click())

    expect(screen.queryByText('orphan')).toBeNull()
  })

  it('throws when used outside a PortalsProvider', () => {
    // React reports the render error before rethrowing it.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Portalled slot="a" text="x" />)).toThrow(
      'usePortals must be used within',
    )
  })
})
