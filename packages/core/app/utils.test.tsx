import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { generateAutomergeUrl } from '@automerge/automerge-repo'
import { isSyncServerUrl, setAutomergeUrl, useAutomergeUrl } from './utils'

const STORED_URL = generateAutomergeUrl()
const SEED_URL = generateAutomergeUrl()
const IMPORTED_URL = generateAutomergeUrl()

function Probe() {
  const { automergeUrl } = useAutomergeUrl()
  return <span data-testid="url">{automergeUrl ?? 'none'}</span>
}

describe('useAutomergeUrl', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(cleanup)

  it('reads the stored url', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    render(<Probe />)
    expect(screen.getByTestId('url')).toHaveTextContent(STORED_URL)
  })

  it('lets a pairing link seed the url ahead of storage', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    window.history.replaceState({}, '', `/?am=${SEED_URL}`)
    render(<Probe />)
    expect(screen.getByTestId('url')).toHaveTextContent(SEED_URL)
  })

  // The bug behind TAP-87: importing a host's url wrote storage and nothing
  // re-rendered, so the app looked inert until the next launch.
  it('re-renders readers when the url is written', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    render(<Probe />)

    act(() => {
      setAutomergeUrl(IMPORTED_URL)
    })

    expect(screen.getByTestId('url')).toHaveTextContent(IMPORTED_URL)
  })

  it('drops the `am` seed so an explicit write wins over it', () => {
    window.history.replaceState({}, '', `/?am=${SEED_URL}&keep=1`)
    render(<Probe />)

    act(() => {
      setAutomergeUrl(IMPORTED_URL)
    })

    expect(screen.getByTestId('url')).toHaveTextContent(IMPORTED_URL)
    expect(window.location.search).toBe('?keep=1')
  })

  it('stops notifying a reader once it has unmounted', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    render(<Probe />)
    cleanup()

    expect(() => setAutomergeUrl(IMPORTED_URL)).not.toThrow()
    expect(localStorage.getItem('automergeUrl')).toBe(IMPORTED_URL)
  })
})

describe('isSyncServerUrl', () => {
  it('returns false if the value is not a valid sync server URL', () => {
    expect(isSyncServerUrl(123)).toBe(false)
    expect(isSyncServerUrl('abc')).toBe(false)
    expect(isSyncServerUrl('https://example.com')).toBe(false)
  })

  it('returns true if the value is a valid sync server URL', () => {
    expect(isSyncServerUrl('wss://example.com')).toBe(true)
    expect(isSyncServerUrl('ws://example.com')).toBe(true)
  })
})
