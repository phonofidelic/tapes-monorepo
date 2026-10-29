/**
 * The hosts whose vouches this reader counts as the person's own signature.
 *
 * A vouch proves that a host key signed it, nothing more. Whether that host
 * is worth believing is the reader's decision, so this list is kept here
 * rather than in the provenance package. The operator adds a host from a
 * vouch in the Library and removes it in Settings.
 *
 * The list is per device, like the pins. Which hosts this operator believes is
 * not a fact about the root document, so it must not go in it, where it would
 * sync to every peer and be editable by all of them.
 */

// Not in the `settings` blob, which is a flat map of strings that three
// separate readers parse and that is rewritten whole on every setting change.
const TRUSTED_HOSTS_KEY = 'tapes.trustedHosts'

/** A host key the operator believes, with the label from its vouches. */
export type TrustedHost = {
  /** The host's base64url Ed25519 public key. */
  hostKey: string
  /** The host's own name for itself, as its vouches carry it. */
  hostLabel: string
  /** When the operator added it, by this device's clock. */
  trustedAt: string
}

type StoredHosts = Record<string, { hostLabel: string; trustedAt: string }>

const listeners = new Set<() => void>()

// `useSyncExternalStore` compares snapshots by identity, so the parsed list is
// held against the bytes it came from rather than rebuilt on every read.
let cached: { raw: string; hosts: TrustedHost[] } | undefined

export function subscribeToTrustedHosts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The trusted hosts, most recently added first. */
export function readTrustedHosts(): TrustedHost[] {
  const raw = rawStored()
  if (cached?.raw !== raw) {
    const hosts = Object.entries(parse(raw))
      .map(([hostKey, host]) => ({ hostKey, ...host }))
      .sort((a, b) => b.trustedAt.localeCompare(a.trustedAt))
    cached = { raw, hosts }
  }
  return cached.hosts
}

export function isTrustedHost(hostKey: string | undefined): boolean {
  return hostKey !== undefined && hostKey in parse(rawStored())
}

/**
 * Starts counting this host's vouches. Trusting a host already on the list
 * refreshes its label, since the operator is acting on a newer vouch.
 */
export function trustHost(host: {
  hostKey: string
  hostLabel: string
  trustedAt?: Date
}): void {
  write({
    ...parse(rawStored()),
    [host.hostKey]: {
      hostLabel: host.hostLabel,
      trustedAt: (host.trustedAt ?? new Date()).toISOString(),
    },
  })
}

/**
 * Stops counting this host's vouches. The vouches themselves are untouched:
 * they go back to being shown with the host that signed them.
 */
export function untrustHost(hostKey: string): void {
  const hosts = parse(rawStored())
  delete hosts[hostKey]
  write(hosts)
}

function rawStored(): string {
  try {
    return globalThis.localStorage?.getItem(TRUSTED_HOSTS_KEY) ?? '{}'
  } catch {
    // No storage at all, as in SSR or a locked-down browser.
    return '{}'
  }
}

function parse(raw: string): StoredHosts {
  try {
    const hosts: unknown = JSON.parse(raw)
    return typeof hosts === 'object' && hosts !== null && !Array.isArray(hosts)
      ? (hosts as StoredHosts)
      : {}
  } catch {
    // Corrupt JSON. Trusting nobody is the safe reading.
    return {}
  }
}

function write(hosts: StoredHosts) {
  try {
    globalThis.localStorage?.setItem(TRUSTED_HOSTS_KEY, JSON.stringify(hosts))
  } catch (error) {
    console.warn('Could not store the trusted hosts', error)
  }
  for (const listener of listeners) {
    listener()
  }
}
