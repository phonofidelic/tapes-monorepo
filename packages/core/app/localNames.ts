/**
 * The names this operator gave the keys they recognise.
 *
 * Every name that arrives over the wire is self-reported. A device sends its
 * own label, a host puts its own name in the pairing link, and a person picks
 * the name a host's roster shows. Nothing checks any of them, so none of them
 * is recognition. A name kept here was typed by the person reading it, which
 * is, and it wins wherever both exist.
 *
 * Keyed by public key, so one store covers person keys, device keys and host
 * keys. The kind is stored with the name, so a duplicate is only reported
 * against keys of the same kind. Kept per device, like the pins and the
 * trusted hosts, and never in the Automerge document, where it would sync to
 * every peer and be editable by all of them.
 *
 * Nothing here is suggested or derived. An unnamed key stays unnamed, and the
 * surfaces fall back to a fingerprint rather than to a name nobody chose.
 */

// Not in the `settings` blob, which is a flat map of strings that three
// separate readers parse and that is rewritten whole on every setting change.
const LOCAL_NAMES_KEY = 'tapes.localNames'

/** What a named key belongs to. A name is only compared within one kind. */
export type NamedKeyKind = 'person' | 'device' | 'host'

/** A name this operator typed for one public key. */
export type LocalName = {
  /** The base64url Ed25519 public key the name belongs to. */
  key: string
  kind: NamedKeyKind
  name: string
  /** When the operator last saved it, by this device's clock. */
  namedAt: string
}

type StoredName = { kind: NamedKeyKind; name: string; namedAt: string }

type StoredNames = Record<string, StoredName>

const listeners = new Set<() => void>()

// `useSyncExternalStore` compares snapshots by identity, so the parsed list is
// held against the bytes it came from rather than rebuilt on every read.
let cached: { raw: string; names: LocalName[] } | undefined

export function subscribeToLocalNames(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Every named key, most recently named first. */
export function readLocalNames(): LocalName[] {
  const raw = rawStored()
  if (cached?.raw !== raw) {
    const names = Object.entries(parse(raw))
      .map(([key, stored]) => ({ key, ...stored }))
      .sort((a, b) => b.namedAt.localeCompare(a.namedAt))
    cached = { raw, names }
  }
  return cached.names
}

/** The name this operator gave that key, or undefined if they gave none. */
export function readLocalName(key: string | undefined): string | undefined {
  if (key === undefined) {
    return undefined
  }
  return parse(rawStored())[key]?.name
}

/**
 * Names a key, or clears the name when nothing printable is left. Saving over
 * a name replaces it, since the operator is correcting what they typed.
 */
export function setLocalName(named: {
  key: string
  kind: NamedKeyKind
  name: string
  namedAt?: Date
}): void {
  const name = named.name.trim()
  if (name.length === 0) {
    clearLocalName(named.key)
    return
  }
  write({
    ...parse(rawStored()),
    [named.key]: {
      kind: named.kind,
      name,
      namedAt: (named.namedAt ?? new Date()).toISOString(),
    },
  })
}

/** Forgets the name. The key goes back to showing its fingerprint. */
export function clearLocalName(key: string): void {
  const names = parse(rawStored())
  if (!(key in names)) {
    return
  }
  delete names[key]
  write(names)
}

/**
 * The other keys of this kind already wearing that name. Case and surrounding
 * space are ignored, because two names that read the same defeat the point of
 * naming either. The caller warns and saves anyway: refusing would leave an
 * operator who really does have two "Studio phone"s with no way to say so.
 */
export function localNameClashes(named: {
  key: string
  kind: NamedKeyKind
  name: string
}): LocalName[] {
  const wanted = named.name.trim().toLocaleLowerCase()
  if (wanted.length === 0) {
    return []
  }
  return readLocalNames().filter(
    (each) =>
      each.key !== named.key &&
      each.kind === named.kind &&
      each.name.toLocaleLowerCase() === wanted,
  )
}

function rawStored(): string {
  try {
    return globalThis.localStorage?.getItem(LOCAL_NAMES_KEY) ?? '{}'
  } catch {
    // No storage at all, as in SSR or a locked-down browser.
    return '{}'
  }
}

function parse(raw: string): StoredNames {
  try {
    const names: unknown = JSON.parse(raw)
    if (typeof names !== 'object' || names === null || Array.isArray(names)) {
      return {}
    }
    // One bad entry must not cost the operator every other name, so each is
    // checked on its own rather than trusting the file as a whole.
    return Object.fromEntries(
      Object.entries(names as Record<string, unknown>).filter(
        (entry): entry is [string, StoredName] => isStoredName(entry[1]),
      ),
    )
  } catch {
    // Corrupt JSON. No names is the honest reading: a wrong name here would
    // be shown as recognition.
    return {}
  }
}

function isStoredName(value: unknown): value is StoredName {
  const stored = value as Partial<StoredName> | null
  return (
    typeof stored === 'object' &&
    stored !== null &&
    typeof stored.name === 'string' &&
    stored.name.length > 0 &&
    typeof stored.namedAt === 'string' &&
    (stored.kind === 'person' ||
      stored.kind === 'device' ||
      stored.kind === 'host')
  )
}

function write(names: StoredNames) {
  try {
    globalThis.localStorage?.setItem(LOCAL_NAMES_KEY, JSON.stringify(names))
  } catch (error) {
    console.warn('Could not store the local names', error)
  }
  for (const listener of listeners) {
    listener()
  }
}
