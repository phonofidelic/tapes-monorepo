import { createContext, useContext } from 'react'
import type { BlobEndpoint } from '@/blobClient'

/**
 * The hosts this device sends and fetches recorded audio from, in the order
 * to try them. Each shell resolves its own list. The electron renderer learns
 * its embedded host from IPC and adds any remote server the user paired with.
 * A hosted web guest uses its own origin plus its pairing token. An empty
 * list is a supported state, not an error: a standalone web client has no
 * host, so its recordings stay in OPFS and never gain a blob descriptor.
 */
// A stable identity, so a shell that resolves no endpoints does not hand every
// effect depending on this context a new array on each render.
const EMPTY: readonly BlobEndpoint[] = []

const BlobContext = createContext<readonly BlobEndpoint[]>(EMPTY)

export function BlobProvider({
  endpoints,
  children,
}: {
  endpoints: readonly BlobEndpoint[] | undefined
  children: React.ReactNode
}) {
  return (
    <BlobContext.Provider value={endpoints ?? EMPTY}>
      {children}
    </BlobContext.Provider>
  )
}

export function useBlobEndpoints(): readonly BlobEndpoint[] {
  return useContext(BlobContext)
}

/**
 * Where new bytes go. Uploads pick one host rather than the first that
 * answers. The head of the list is this device's nearest store, which is its
 * own embedded server when it has one.
 */
export function useUploadEndpoint(): BlobEndpoint | undefined {
  return useContext(BlobContext)[0]
}
