import crypto from 'crypto'
import path from 'path'
import { createReadStream, createWriteStream, type ReadStream } from 'fs'
import {
  link,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { pipeline } from 'stream/promises'
import type { Readable } from 'stream'

/**
 * A content-addressed store for recorded audio, owned by the sync host.
 *
 * Recordings are addressed by the sha-256 of their bytes rather than by path
 * because the path is not stable: audio files live in a directory the user
 * chose, and `EditRecordingChannel` renames the file on disk whenever the
 * recording is retitled. `ingestFile` therefore hardlinks the user's file into
 * the store, so the object and the user's copy share an inode and a rename
 * cannot break serving.
 *
 * Deliberately free of any `electron` import: `syncServer.ts` imports nothing
 * from electron, which is what lets the HTTP surface be tested against a real
 * server in a plain node process. Path resolution lives in `syncServerConfig`.
 */

const HASH_PATTERN = /^[0-9a-f]{64}$/

export type BlobMeta = {
  hash: string
  size: number
  mimeType: string
  /** Leading-dot extension, e.g. '.wav'. Used for cache filenames. */
  ext: string
  createdAt: string
}

export type IngestResult = {
  meta: BlobMeta
  /** True when the bytes were already in the store; only a ref was added. */
  deduped: boolean
}

export type IngestFileResult = IngestResult & {
  mode: 'hardlink' | 'copy' | 'deduped'
}

export type BlobStoreDeps = {
  /**
   * Injected so the cross-filesystem fallback can be exercised in tests: CI
   * has no second filesystem to produce a real EXDEV.
   */
  link?: typeof link
}

export class BlobTooLargeError extends Error {
  readonly code = 'BLOB_TOO_LARGE'
  constructor(readonly limit: number) {
    super(`Blob exceeds the ${limit} byte limit`)
  }
}

export const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
}

export const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'audio/mp4': '.mp4',
  'audio/webm': '.webm',
}

export function isValidBlobHash(hash: string): boolean {
  return HASH_PATTERN.test(hash)
}

/**
 * Two-character fanout. A flat directory of objects degrades badly on ext4 and
 * NTFS once a library grows into the thousands.
 */
function shard(hash: string): string {
  return hash.slice(0, 2)
}

export type BlobStore = ReturnType<typeof createBlobStore>

export function createBlobStore(root: string, deps: BlobStoreDeps = {}) {
  const linkFile = deps.link ?? link

  const tmpDir = path.join(root, 'tmp')
  const objectPath = (hash: string) =>
    path.join(root, 'objects', shard(hash), hash)
  const metaPath = (hash: string) =>
    path.join(root, 'meta', shard(hash), `${hash}.json`)
  const refsPath = (hash: string) =>
    path.join(root, 'refs', shard(hash), `${hash}.json`)

  // The host is a single process, so serializing ref mutations per hash in
  // memory is enough to keep the refs file consistent under concurrent
  // uploads of the same content.
  const locks = new Map<string, Promise<void>>()

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = locks.get(key) ?? Promise.resolve()
    // Run whether or not the previous holder settled successfully; one
    // failed ingest must not wedge the queue for that hash.
    const run = tail.then(fn, fn)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    locks.set(key, settled)
    void settled.then(() => {
      if (locks.get(key) === settled) {
        locks.delete(key)
      }
    })
    return run
  }

  async function writeJsonAtomic(target: string, value: unknown) {
    await mkdir(path.dirname(target), { recursive: true })
    const scratch = path.join(tmpDir, `${crypto.randomUUID()}.json`)
    await mkdir(tmpDir, { recursive: true })
    await writeFile(scratch, JSON.stringify(value, null, 2))
    await rename(scratch, target)
  }

  async function readRefs(hash: string): Promise<string[]> {
    try {
      const parsed = JSON.parse(await readFile(refsPath(hash), 'utf-8')) as {
        refs?: unknown
      }
      return Array.isArray(parsed.refs)
        ? parsed.refs.filter((ref): ref is string => typeof ref === 'string')
        : []
    } catch {
      return []
    }
  }

  async function readMeta(hash: string): Promise<BlobMeta | null> {
    try {
      return JSON.parse(await readFile(metaPath(hash), 'utf-8')) as BlobMeta
    } catch {
      return null
    }
  }

  async function has(hash: string): Promise<boolean> {
    if (!isValidBlobHash(hash)) {
      return false
    }
    try {
      await stat(objectPath(hash))
      return true
    } catch {
      return false
    }
  }

  /** Metadata for a stored blob, or null when the object is not present. */
  async function statBlob(hash: string): Promise<BlobMeta | null> {
    if (!isValidBlobHash(hash)) {
      return null
    }
    const meta = await readMeta(hash)
    if (!meta) {
      return null
    }
    // The meta file can outlive its object if a delete was interrupted, so
    // the object is the source of truth for presence.
    try {
      const stats = await stat(objectPath(hash))
      return { ...meta, size: stats.size }
    } catch {
      return null
    }
  }

  function readBlob(
    hash: string,
    range?: { start?: number; end?: number },
  ): ReadStream {
    return createReadStream(objectPath(hash), range)
  }

  async function addRef(hash: string, docUrl: string): Promise<string[]> {
    return withLock(hash, async () => {
      const refs = await readRefs(hash)
      if (refs.includes(docUrl)) {
        return refs
      }
      const next = [...refs, docUrl]
      await writeJsonAtomic(refsPath(hash), { refs: next })
      return next
    })
  }

  /**
   * Drops one owner. When the last owner goes the bytes are unlinked — this is
   * what makes deleting a recording actually reclaim space, which embedding
   * the audio in the Automerge doc could never do.
   */
  async function releaseRef(
    hash: string,
    docUrl: string,
  ): Promise<{ removed: boolean; refs: string[] }> {
    return withLock(hash, async () => {
      const refs = await readRefs(hash)
      const next = refs.filter((ref) => ref !== docUrl)
      if (next.length === refs.length && refs.length > 0) {
        return { removed: false, refs }
      }
      if (next.length > 0) {
        await writeJsonAtomic(refsPath(hash), { refs: next })
        return { removed: false, refs: next }
      }
      await Promise.all([
        rm(objectPath(hash), { force: true }),
        rm(metaPath(hash), { force: true }),
        rm(refsPath(hash), { force: true }),
      ])
      return { removed: true, refs: [] }
    })
  }

  async function finalizeMeta(
    hash: string,
    size: number,
    mimeType: string,
    ext: string,
  ): Promise<BlobMeta> {
    const meta: BlobMeta = {
      hash,
      size,
      mimeType,
      ext,
      createdAt: new Date().toISOString(),
    }
    await writeJsonAtomic(metaPath(hash), meta)
    return meta
  }

  function resolveExt(mimeType: string, fallbackExt?: string): string {
    if (fallbackExt) {
      return fallbackExt.startsWith('.') ? fallbackExt : `.${fallbackExt}`
    }
    return EXTENSION_BY_MIME_TYPE[mimeType] ?? '.bin'
  }

  /**
   * Streams an upload into the store, hashing as it goes. Hashing on the host
   * rather than the client keeps a phone from having to read a 50 MB+ file
   * into memory, and avoids `crypto.subtle`, which is unavailable in the
   * plain-HTTP LAN mode the host can be configured into.
   */
  async function ingestStream(
    source: Readable,
    options: {
      mimeType: string
      ext?: string
      docUrl: string
      maxBytes?: number
    },
  ): Promise<IngestResult> {
    await mkdir(tmpDir, { recursive: true })
    const scratch = path.join(tmpDir, crypto.randomUUID())
    const hasher = crypto.createHash('sha256')
    let size = 0
    let tooLarge = false

    const sink = createWriteStream(scratch)
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            size += chunk.length
            if (options.maxBytes !== undefined && size > options.maxBytes) {
              tooLarge = true
              throw new BlobTooLargeError(options.maxBytes)
            }
            hasher.update(chunk)
            yield chunk
          }
        },
        sink,
      )
    } catch (error) {
      await rm(scratch, { force: true })
      throw tooLarge ? new BlobTooLargeError(options.maxBytes ?? 0) : error
    }

    const hash = hasher.digest('hex')
    const ext = resolveExt(options.mimeType, options.ext)

    if (await has(hash)) {
      await rm(scratch, { force: true })
      await addRef(hash, options.docUrl)
      const existing = await statBlob(hash)
      return {
        meta:
          existing ?? (await finalizeMeta(hash, size, options.mimeType, ext)),
        deduped: true,
      }
    }

    await mkdir(path.dirname(objectPath(hash)), { recursive: true })
    await rename(scratch, objectPath(hash))
    const meta = await finalizeMeta(hash, size, options.mimeType, ext)
    await addRef(hash, options.docUrl)
    return { meta, deduped: false }
  }

  /**
   * Ingests a file already on the host's disk (the electron recording path).
   * Hardlinks where possible so the bytes are not duplicated; note the
   * consequence that deleting the file in Finder no longer frees the space
   * until the store ref is released too.
   */
  async function ingestFile(
    filepath: string,
    options: { docUrl: string; mimeType?: string },
  ): Promise<IngestFileResult> {
    const ext = path.extname(filepath).toLowerCase()
    const mimeType =
      options.mimeType ??
      MIME_TYPE_BY_EXTENSION[ext] ??
      'application/octet-stream'

    const hasher = crypto.createHash('sha256')
    let size = 0
    await pipeline(createReadStream(filepath), async function (chunks) {
      for await (const chunk of chunks as AsyncIterable<Buffer>) {
        size += chunk.length
        hasher.update(chunk)
      }
    })
    const hash = hasher.digest('hex')

    if (await has(hash)) {
      await addRef(hash, options.docUrl)
      const existing = await statBlob(hash)
      return {
        meta: existing ?? (await finalizeMeta(hash, size, mimeType, ext)),
        deduped: true,
        mode: 'deduped',
      }
    }

    const target = objectPath(hash)
    await mkdir(path.dirname(target), { recursive: true })

    let mode: IngestFileResult['mode'] = 'hardlink'
    try {
      await linkFile(filepath, target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        // Raced with another ingest of the same content; the object is there.
        mode = 'deduped'
      } else if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP') {
        // Different filesystem (or one that will not link) — fall back to a
        // real copy, staged through tmp so a crash cannot leave a partial
        // object at its content address.
        await mkdir(tmpDir, { recursive: true })
        const scratch = path.join(tmpDir, crypto.randomUUID())
        await copyFile(filepath, scratch)
        await rename(scratch, target)
        mode = 'copy'
      } else {
        throw error
      }
    }

    const meta = await finalizeMeta(hash, size, mimeType, ext)
    await addRef(hash, options.docUrl)
    return { meta, deduped: mode === 'deduped', mode }
  }

  /** Total bytes held, for the store budget check on upload. */
  async function totalBytes(): Promise<number> {
    const objectsRoot = path.join(root, 'objects')
    let total = 0
    let shards: string[]
    try {
      shards = await readdir(objectsRoot)
    } catch {
      return 0
    }
    for (const dir of shards) {
      let entries: string[]
      try {
        entries = await readdir(path.join(objectsRoot, dir))
      } catch {
        continue
      }
      for (const entry of entries) {
        try {
          total += (await stat(path.join(objectsRoot, dir, entry))).size
        } catch {
          // Raced with a delete; nothing to count.
        }
      }
    }
    return total
  }

  /** Clears uploads abandoned mid-stream. Run at startup. */
  async function sweepTmp(maxAgeMs: number): Promise<number> {
    let entries: string[]
    try {
      entries = await readdir(tmpDir)
    } catch {
      return 0
    }
    const cutoff = Date.now() - maxAgeMs
    let removed = 0
    for (const entry of entries) {
      const target = path.join(tmpDir, entry)
      try {
        if ((await stat(target)).mtimeMs < cutoff) {
          await rm(target, { force: true })
          removed += 1
        }
      } catch {
        // Already gone.
      }
    }
    return removed
  }

  return {
    has,
    stat: statBlob,
    read: readBlob,
    refs: readRefs,
    addRef,
    releaseRef,
    ingestStream,
    ingestFile,
    totalBytes,
    sweepTmp,
  }
}
