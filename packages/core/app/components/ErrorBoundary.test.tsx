import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ErrorWithRecover } from '@/types'
import { ErrorBoundary, GenericErrorFallbackScreen } from './ErrorBoundary'

class RecoverableError extends Error implements ErrorWithRecover {
  constructor(
    public readonly recover: () => void,
    public readonly recoveryCta: string,
    public readonly userMessage?: string,
  ) {
    super('recoverable')
  }
}

function Throws({ error }: { error: Error }): React.ReactNode {
  throw error
}

const renderFailing = (error: Error, onTryRecover?: () => void) =>
  render(
    <ErrorBoundary
      fallback={<GenericErrorFallbackScreen onTryRecover={onTryRecover} />}
    >
      <Throws error={error} />
    </ErrorBoundary>,
  )

beforeEach(() => {
  // React reports the caught error, and the boundary logs it again.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <p>content</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByText('fallback')).toBeNull()
  })

  it('replaces its children with the fallback when one throws', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <Throws error={new Error('boom')} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('fallback')).toBeInTheDocument()
  })
})

describe('GenericErrorFallbackScreen', () => {
  it('offers the caller’s recovery for an ordinary error', async () => {
    const onTryRecover = vi.fn()
    renderFailing(new Error('boom'), onTryRecover)

    expect(screen.getByText('Something went wrong...')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))

    expect(onTryRecover).toHaveBeenCalledOnce()
  })

  it('offers no button when the caller has no recovery', () => {
    renderFailing(new Error('boom'))

    expect(screen.getByText('Something went wrong...')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // An error that knows how to recover wins over the caller's generic reload,
  // because a reload alone would hit the same error again.
  it('offers the error’s own recovery, with its message and label', async () => {
    const recover = vi.fn()
    const onTryRecover = vi.fn()
    renderFailing(
      new RecoverableError(recover, 'Clear and reload', 'The link is invalid.'),
      onTryRecover,
    )

    expect(screen.getByText('The link is invalid.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear and reload' }),
    )

    expect(recover).toHaveBeenCalledOnce()
    expect(onTryRecover).not.toHaveBeenCalled()
  })

  // A recover() that uses `this` must still work when called from a click.
  it('calls recover on the error itself', async () => {
    class SelfRecovering extends Error implements ErrorWithRecover {
      recoveryCta = 'Recover'
      recovered = false
      recover() {
        this.recovered = true
      }
    }
    const error = new SelfRecovering()
    renderFailing(error)

    await userEvent.click(screen.getByRole('button', { name: 'Recover' }))

    expect(error.recovered).toBe(true)
  })

  it('shows only the button when the error has no message for the user', () => {
    const { container } = renderFailing(new RecoverableError(vi.fn(), 'Reload'))

    expect(container).toHaveTextContent(/^Something went wrong\.\.\.Reload$/)
  })

  it('reads the error of its own boundary when boundaries nest', () => {
    render(
      <ErrorBoundary fallback={<GenericErrorFallbackScreen />}>
        <p>outer content</p>
        <ErrorBoundary fallback={<GenericErrorFallbackScreen />}>
          <Throws error={new RecoverableError(vi.fn(), 'Inner recovery')} />
        </ErrorBoundary>
      </ErrorBoundary>,
    )

    expect(screen.getByText('outer content')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Inner recovery' }),
    ).toBeInTheDocument()
  })
})
