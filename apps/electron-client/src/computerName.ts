import { execFileSync } from 'child_process'
import os from 'os'
import { sanitizeLabel } from '@tapes-monorepo/sync-protocol'

/**
 * The Mac's own name, such as "Studio Mac", from System Settings > Sharing.
 * It is the host's name until the user sets one. Falls back to the network
 * hostname, which macOS derives from the same name.
 */

/** Used when the system gives no usable name. */
export const FALLBACK_HOST_LABEL = 'Tapes host'

export function readComputerName(): string {
  try {
    const name = sanitizeLabel(
      execFileSync('scutil', ['--get', 'ComputerName'], {
        encoding: 'utf8',
        timeout: 1000,
      }),
    )
    if (name) {
      return name
    }
  } catch {
    // Not macOS, or scutil failed. The hostname is next.
  }
  return (
    sanitizeLabel(os.hostname().replace(/\.local$/, '')) ?? FALLBACK_HOST_LABEL
  )
}
