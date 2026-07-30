import { createContext, useContext } from 'react'
import type { BlobEndpoint } from '@/blobClient'

/**
 * Where this device sends and fetches recorded audio.
 *
 * Each shell resolves its own: the electron renderer learns it from the
 * embedded server over IPC, a hosted web guest from its own origin plus the
 * token it was paired with. `undefined` is a supported state, not an error — a
 * standalone web-client has no host, so its recordings stay in OPFS and never
 * gain a blob descriptor.
 */
const BlobContext = createContext<BlobEndpoint | undefined>(undefined)

export function BlobProvider({
  endpoint,
  children,
}: {
  endpoint: BlobEndpoint | undefined
  children: React.ReactNode
}) {
  return (
    <BlobContext.Provider value={endpoint}>{children}</BlobContext.Provider>
  )
}

export function useBlobEndpoint(): BlobEndpoint | undefined {
  return useContext(BlobContext)
}
