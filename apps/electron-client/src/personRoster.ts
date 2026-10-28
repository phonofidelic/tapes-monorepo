import path from 'path'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import type { DeviceCertificate, Signed } from '@tapes-monorepo/provenance'
import { isPinHash, type PinHash } from './pinHash'

/**
 * The people this host has met, kept in one JSON file. The host vouches for a
 * person's new device only if they are on it. The host never holds a person's
 * private key.
 *
 * Do not import `electron` here. The sync server uses this module, and it
 * stays testable in a plain node process.
 */

export type RosterEntry = {
  personKey: string
  name: string
  /** The certificate the person joined with, and its statement address. */
  firstCertificate: { address: string; signed: Signed<DeviceCertificate> }
  pin?: PinHash
  /**
   * Wrong PINs since the last right one. Kept here so a restart does not hand
   * a guesser a fresh set of tries.
   */
  pinFailures?: number
  /** The host's clock. */
  joinedAt: string
}

export type PersonRoster = {
  list(): Promise<RosterEntry[]>
  find(personKey: string): Promise<RosterEntry | undefined>
  /** Adds the person, or replaces the entry with the same person key. */
  put(entry: RosterEntry): Promise<void>
  /**
   * Changes one person's entry, after every write before it. `change` returns
   * the new entry, or undefined to leave it. Resolves with what was written,
   * or undefined if nothing was.
   */
  update(
    personKey: string,
    change: (entry: RosterEntry) => RosterEntry | undefined,
  ): Promise<RosterEntry | undefined>
}

export function createPersonRoster(filePath: string): PersonRoster {
  let cached: Promise<RosterEntry[]> | undefined
  // Writes run one at a time, so two joins cannot each drop the other's entry.
  let writing: Promise<unknown> = Promise.resolve()

  const load = () => (cached ??= readRoster(filePath))

  const queue = <T>(task: () => Promise<T>): Promise<T> => {
    const write = writing.then(task)
    writing = write.catch(() => undefined)
    return write
  }

  const replace = async (entries: RosterEntry[], entry: RosterEntry) => {
    const next = entries.filter(
      (existing) => existing.personKey !== entry.personKey,
    )
    next.push(entry)
    await writeRoster(filePath, next)
    cached = Promise.resolve(next)
  }

  return {
    list: load,
    async find(personKey) {
      return (await load()).find((entry) => entry.personKey === personKey)
    },
    put(entry) {
      return queue(async () => replace(await load(), entry))
    },
    update(personKey, change) {
      return queue(async () => {
        const entries = await load()
        const entry = entries.find((each) => each.personKey === personKey)
        const next = entry && change(entry)
        if (next) {
          await replace(entries, next)
        }
        return next
      })
    },
  }
}

async function readRoster(filePath: string): Promise<RosterEntry[]> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
  const parsed = JSON.parse(text) as { people?: unknown }
  if (!Array.isArray(parsed.people)) {
    // Starting empty here would forget every person, so leave the file for
    // someone to look at.
    throw new Error(`The roster at ${filePath} has no list of people`)
  }
  return parsed.people.filter(isRosterEntry)
}

async function writeRoster(
  filePath: string,
  people: RosterEntry[],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  // Written whole to a temp file and renamed into place, so a crash mid-write
  // leaves the old roster.
  const scratch = `${filePath}.tmp`
  await writeFile(scratch, `${JSON.stringify({ people }, null, 2)}\n`)
  await rename(scratch, filePath)
}

function isRosterEntry(value: unknown): value is RosterEntry {
  const entry = value as Partial<RosterEntry> | null
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.personKey === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.firstCertificate?.address === 'string' &&
    typeof entry.firstCertificate.signed?.signature === 'string' &&
    (entry.pin === undefined || isPinHash(entry.pin)) &&
    (entry.pinFailures === undefined || Number.isInteger(entry.pinFailures)) &&
    typeof entry.joinedAt === 'string'
  )
}
