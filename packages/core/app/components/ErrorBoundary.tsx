import React, { createContext, ErrorInfo, useContext } from 'react'
import { Button } from '@tapes-monorepo/ui'
import { ScreenLoader } from './ScreenLoader'

export interface ErrorWithRecover extends Error {
  recover(): void
}
export class ErrorBoundary extends React.Component<{
  children: React.ReactNode
  fallback: React.ReactNode
}> {
  state:
    | { hasError: false; error: undefined }
    | { hasError: true; error: ErrorWithRecover | Error }

  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: undefined }
  }

  static getDerivedStateFromError(error: Error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.log(
      error,
      // Example "componentStack":
      //   in ComponentThatThrows (created by App)
      //   in ErrorBoundary (created by App)
      //   in div (created by App)
      //   in App
      info.componentStack,
      // Warning: `captureOwnerStack` is not available in production.
      React.captureOwnerStack(),
    )
  }

  render() {
    return (
      <ErrorContextProvider value={this.state.error}>
        {this.state.hasError ? this.props.fallback : this.props.children}
      </ErrorContextProvider>
    )
  }
}

type ErrorContextValue = ErrorWithRecover | Error | undefined
const ErrorContext = createContext<ErrorContextValue>(undefined)

function ErrorContextProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: ErrorContextValue
}) {
  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>
}

export function useErrorContext() {
  const context = useContext(ErrorContext)

  if (!context) {
    throw new Error(
      'useErrorContext must be used within an ErrorContextProvider',
    )
  }

  return { error: context }
}

function isRecoverableError(
  error: ErrorWithRecover | Error,
): error is ErrorWithRecover {
  return (
    typeof error === 'object' &&
    'recover' in error &&
    typeof error.recover === 'function'
  )
}

export function GenericScreenErrorFallback({
  onTryRecover,
}: {
  onTryRecover?(): void | undefined
}) {
  const { error } = useErrorContext()
  const recover = isRecoverableError(error) ? error.recover : onTryRecover

  return (
    <ScreenLoader message="Something went wrong">
      {recover && (
        <Button
          className="border-subtle text-foreground border p-1 px-2"
          onClick={recover}
        >
          {' '}
          Reload
        </Button>
      )}
    </ScreenLoader>
  )
}
