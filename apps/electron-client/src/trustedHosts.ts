import path from 'path'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'

/**
 * The host keys whose vouches this host's operator accepts as the person's own
 * signature, kept in one JSON file. A vouch is a witness statement, so whether
 * it counts is the reader's decision. This file is that decision.
 *
 * Only the renderer reads it, to decide how the Library names a vouched
 * person. Nothing on the LAN can change it. The host never vouches on another
 * host's word, so the sync server does not consult this list.
 *
 * Do not import `electron` here, so the store stays testable in a plain node
 * process. The caller passes the file path.
 */

export type TrustedHostEntry = {
  /** The trusted host's base64url Ed25519 public key. */
  hostKey: string
  /**
   * The host's own name for itself, copied from the vouch the operator trusted
   * it from. Unverified, and absent for a key the operator typed in.
   */
  hostLabel?: string
  /** This host's clock. */
  addedAt: string
}

export type TrustedHosts = {
  list(): Promise<TrustedHostEntry[]>
  /** Adds the key, or replaces the entry with the same host key. */
  add(entry: TrustedHostEntry): Promise<void>
  /** Resolves true when a key was removed, false when none matched. */
  remove(hostKey: string): Promise<boolean>
}

export function createTrustedHosts(filePath: string): TrustedHosts {
  let cached: Promise<TrustedHostEntry[]> | undefined
  // Writes run one at a time, so two changes cannot each drop the other's.
  let writing: Promise<unknown> = Promise.resolve()

  const load = () => (cached ??= readTrustedHosts(filePath))

  const queue = <T>(task: () => Promise<T>): Promise<T> => {
    const write = writing.then(task)
    writing = write.catch(() => undefined)
    return write
  }

  const save = async (next: TrustedHostEntry[]) => {
    await writeTrustedHosts(filePath, next)
    cached = Promise.resolve(next)
  }

  return {
    list: load,
    add(entry) {
      return queue(async () => {
        const entries = await load()
        await save([
          ...entries.filter((each) => each.hostKey !== entry.hostKey),
          entry,
        ])
      })
    },
    remove(hostKey) {
      return queue(async () => {
        const entries = await load()
        const next = entries.filter((each) => each.hostKey !== hostKey)
        if (next.length === entries.length) {
          return false
        }
        await save(next)
        return true
      })
    },
  }
}

async function readTrustedHosts(filePath: string): Promise<TrustedHostEntry[]> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
  const parsed = JSON.parse(text) as { hosts?: unknown }
  if (!Array.isArray(parsed.hosts)) {
    // Starting empty here would silently withdraw the operator's trust, so
    // leave the file for someone to look at.
    throw new Error(`The trusted hosts at ${filePath} have no list of hosts`)
  }
  return parsed.hosts.filter(isTrustedHostEntry)
}

async function writeTrustedHosts(
  filePath: string,
  hosts: TrustedHostEntry[],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  // Written whole to a temp file and renamed into place, so a crash mid-write
  // leaves the old list.
  const scratch = `${filePath}.tmp`
  await writeFile(scratch, `${JSON.stringify({ hosts }, null, 2)}\n`)
  await rename(scratch, filePath)
}

function isTrustedHostEntry(value: unknown): value is TrustedHostEntry {
  const entry = value as Partial<TrustedHostEntry> | null
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.hostKey === 'string' &&
    (entry.hostLabel === undefined || typeof entry.hostLabel === 'string') &&
    typeof entry.addedAt === 'string'
  )
}
