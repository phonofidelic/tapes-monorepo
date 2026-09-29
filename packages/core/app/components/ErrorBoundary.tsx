import React, { createContext, ErrorInfo, useContext } from 'react'
import { Button } from '@tapes-monorepo/ui'
import { type ErrorWithRecover } from '@/types'
import { ScreenLoader } from './ScreenLoader'
export class ErrorBoundary extends React.Component<{
  children: React.ReactNode
  fallback: React.ReactNode
}> {
  state:
    | { hasError: false; error: undefined }
    | { hasError: true; error: Error | undefined }

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

type ErrorContextValue<T> = T | ErrorWithRecover | Error | undefined

const ErrorContext = createContext<ErrorContextValue<unknown>>(undefined)

function ErrorContextProvider<T>({
  children,
  value,
}: {
  children: React.ReactNode
  value: ErrorContextValue<T>
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

  return context
}

function isRecoverableError(error: unknown): error is ErrorWithRecover {
  return (
    error !== null &&
    typeof error === 'object' &&
    'recover' in error &&
    typeof error.recover === 'function'
  )
}

export function GenericErrorFallbackScreen({
  onTryRecover,
}: {
  onTryRecover?(): void | undefined
}) {
  const error = useErrorContext()
  if (isRecoverableError(error)) {
    return (
      <ScreenLoader message="Something went wrong...">
        <div className="mx-auto mt-8 flex max-w-lg flex-col items-center gap-8 p-4">
          <div className="text-foreground text-center text-sm">
            {error.userMessage}
          </div>
          <div>
            <Button
              className="border-subtle text-foreground border p-1 px-2"
              onClick={() => error.recover()}
            >
              {error.recoveryCta}
            </Button>
          </div>
        </div>
      </ScreenLoader>
    )
  }

  return (
    <ScreenLoader message="Something went wrong...">
      {onTryRecover && (
        <Button
          className="border-subtle text-foreground border p-1 px-2"
          onClick={onTryRecover}
        >
          Reload
        </Button>
      )}
    </ScreenLoader>
  )
}
