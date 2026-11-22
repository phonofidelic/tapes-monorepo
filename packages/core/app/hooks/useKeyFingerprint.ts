import { useEffect, useState } from 'react'
import { keyFingerprint } from '@tapes-monorepo/provenance'

/**
 * The short fingerprint of a public key, for showing a key nobody has named.
 *
 * Hashing is async, so the value arrives a tick after the key. It is held
 * against the key it was computed from, so a row that switches keys never
 * shows the previous key's fingerprint for a frame. Undefined until it lands.
 */
export function useKeyFingerprint(key: string | undefined): string | undefined {
  const [held, setHeld] = useState<{ key: string; fingerprint?: string }>()

  useEffect(() => {
    if (!key) {
      return
    }
    let current = true
    void keyFingerprint(key).then(
      (fingerprint) => current && setHeld({ key, fingerprint }),
    )
    return () => {
      current = false
    }
  }, [key])

  return held && held.key === key ? held.fingerprint : undefined
}
