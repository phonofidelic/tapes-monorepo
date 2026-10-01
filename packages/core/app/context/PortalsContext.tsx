import { createContext, use, useCallback, useEffect, useRef } from 'react'

type PortalsContextValue = {
  portalContainersMapRef: React.RefObject<
    Record<string, React.RefObject<HTMLDivElement | null>>
  >
  setRefsMap(
    key: string,
    newValue: React.RefObject<HTMLDivElement | null>,
  ): void
}

const PortalsContext = createContext<PortalsContextValue | undefined>(undefined)

export const PortalsProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const portalContainersMapRef = useRef<
    Record<string, React.RefObject<HTMLDivElement | null>>
  >({})

  const setRefsMap = (
    key: string,
    newValue: React.RefObject<HTMLDivElement | null>,
  ) => {
    portalContainersMapRef.current[key] = newValue
  }

  return (
    <PortalsContext
      value={{
        portalContainersMapRef,
        setRefsMap,
      }}
    >
      {children}
    </PortalsContext>
  )
}

export const usePortals = (
  containerRefKey: string,
): {
  containerRef: React.RefObject<HTMLDivElement | null>
  container: HTMLDivElement | null
  setContainerRefValue: (
    newContainerRefValue: React.RefObject<HTMLDivElement | null>,
  ) => void
} => {
  const context = use(PortalsContext)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const setContainerRefValue = useCallback(
    (newContainerRefValue: React.RefObject<HTMLDivElement | null>) => {
      if (context === undefined) {
        throw new Error(
          'usePortals must be used within an PortalContextProvider',
        )
      }
      context.setRefsMap(containerRefKey, newContainerRefValue)
    },
    [containerRefKey, context],
  )

  if (context === undefined) {
    throw new Error('usePortals must be used within an PortalContextProvider')
  }

  return {
    containerRef,
    container: context.portalContainersMapRef.current[containerRefKey]?.current,
    setContainerRefValue,
  }
}

export function PortalContainer({
  containerRefKey,
}: {
  containerRefKey: string
}) {
  const { containerRef, setContainerRefValue } = usePortals(containerRefKey)
  const isMountedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current || isMountedRef.current) {
      return
    }
    setContainerRefValue(containerRef)
    isMountedRef.current = true
  }, [containerRef, setContainerRefValue])

  return <div ref={containerRef} />
}
