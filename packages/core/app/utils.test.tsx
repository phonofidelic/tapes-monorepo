import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { generateAutomergeUrl } from '@automerge/automerge-repo'
import {
  InvalidAutomergeUrlError,
  InvalidStoredAutomergeUrlError,
  isSyncServerUrl,
  readAutomergeUrl,
  writeAutomergeUrl,
  useAutomergeUrl,
} from './utils'

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
      writeAutomergeUrl(IMPORTED_URL)
    })

    expect(screen.getByTestId('url')).toHaveTextContent(IMPORTED_URL)
  })

  it('drops the `am` seed so an explicit write wins over it', () => {
    window.history.replaceState({}, '', `/?am=${SEED_URL}&keep=1`)
    render(<Probe />)

    act(() => {
      writeAutomergeUrl(IMPORTED_URL)
    })

    expect(screen.getByTestId('url')).toHaveTextContent(IMPORTED_URL)
    expect(window.location.search).toBe('?keep=1')
  })

  it('stops notifying a reader once it has unmounted', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    render(<Probe />)
    cleanup()

    expect(() => writeAutomergeUrl(IMPORTED_URL)).not.toThrow()
    expect(localStorage.getItem('automergeUrl')).toBe(IMPORTED_URL)
  })
})

describe('readAutomergeUrl', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('returns null on a device with nothing stored', () => {
    expect(readAutomergeUrl()).toBeNull()
  })

  it('returns the stored url', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    expect(readAutomergeUrl()).toBe(STORED_URL)
  })

  it('prefers a pairing link over storage', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    window.history.replaceState({}, '', `/?am=${SEED_URL}`)
    expect(readAutomergeUrl()).toBe(SEED_URL)
  })

  it('rejects a pairing link that is not an automerge url', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    window.history.replaceState({}, '', '/?am=not-a-url')
    expect(() => readAutomergeUrl()).toThrow(InvalidAutomergeUrlError)
  })

  // Treating a bad stored value as missing would create a new library and
  // write over it, losing whatever the user pasted.
  it('rejects a stored value that is not an automerge url', () => {
    localStorage.setItem('automergeUrl', 'not-a-url')
    expect(() => readAutomergeUrl()).toThrow(InvalidStoredAutomergeUrlError)
  })

  // Scanning a host's QR code is how a user gets out of a bad stored value.
  it('lets a valid pairing link through past a bad stored value', () => {
    localStorage.setItem('automergeUrl', 'not-a-url')
    window.history.replaceState({}, '', `/?am=${SEED_URL}`)
    expect(readAutomergeUrl()).toBe(SEED_URL)
  })

  it('makes readers throw on a bad stored value', () => {
    localStorage.setItem('automergeUrl', 'not-a-url')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Probe />)).toThrow(InvalidStoredAutomergeUrlError)
  })
})

// Both reload the page, which jsdom does not implement and will not let a test
// spy on, so these check what the recovery leaves behind for the next load.
describe('invalid url recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops a bad pairing link and keeps the stored url', () => {
    localStorage.setItem('automergeUrl', STORED_URL)
    window.history.replaceState({}, '', '/?am=not-a-url&keep=1')

    new InvalidAutomergeUrlError('not-a-url').recover()

    expect(window.location.search).toBe('?keep=1')
    expect(readAutomergeUrl()).toBe(STORED_URL)
  })

  it('clears a bad stored value so the next load starts a new library', () => {
    localStorage.setItem('automergeUrl', 'not-a-url')

    new InvalidStoredAutomergeUrlError('not-a-url').recover()

    expect(localStorage.getItem('automergeUrl')).toBeNull()
    expect(readAutomergeUrl()).toBeNull()
  })

  it('tells the user what clearing the stored value will do', () => {
    const error = new InvalidStoredAutomergeUrlError('not-a-url')
    expect(error.userMessage).toMatch(/new library/)
  })
})

describe('isSyncServerUrl', () => {
  it('returns false if the value is not a valid sync server URL', () => {
    expect(isSyncServerUrl(123)).toBe(false)
    expect(isSyncServerUrl('')).toBe(false)
    expect(isSyncServerUrl('abc')).toBe(false)
    expect(isSyncServerUrl('https://example.com')).toBe(false)
  })

  it('returns true if the value is a valid sync server URL', () => {
    expect(isSyncServerUrl('wss://example.com')).toBe(true)
    expect(isSyncServerUrl('ws://example.com')).toBe(true)
  })
})
