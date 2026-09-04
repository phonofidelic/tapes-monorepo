import crypto from 'crypto'
import path from 'path'
import { Readable } from 'stream'
import { mkdtemp, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BlobTooLargeError, createBlobStore } from './blobStore'

let root: string
let workspace: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tapes-blobs-'))
  workspace = await mkdtemp(path.join(tmpdir(), 'tapes-recordings-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
})

const sha256 = (value: string | Buffer) =>
  crypto.createHash('sha256').update(value).digest('hex')

async function writeRecording(name: string, contents: string) {
  const filepath = path.join(workspace, name)
  await writeFile(filepath, contents)
  return filepath
}

const DOC_A = 'automerge:doc-a'
const DOC_B = 'automerge:doc-b'

describe('ingestFile', () => {
  it('hardlinks the recording rather than copying it', async () => {
    const store = createBlobStore(root)
    const filepath = await writeRecording('take.wav', 'the audio')

    const result = await store.ingestFile(filepath, { docUrl: DOC_A })

    expect(result.mode).toBe('hardlink')
    expect(result.deduped).toBe(false)
    expect(result.meta.hash).toBe(sha256('the audio'))
    expect(result.meta.mimeType).toBe('audio/wav')
    expect(result.meta.ext).toBe('.wav')
    // Two links to one inode: the user's file and the store object.
    expect((await stat(filepath)).nlink).toBe(2)
  })

  // The reason the store is content-addressed at all: EditRecordingChannel
  // renames the user's file on disk whenever a recording is retitled, so
  // anything that served by path would break the moment a tape was renamed.
  it('keeps serving after the source file is renamed', async () => {
    const store = createBlobStore(root)
    const filepath = await writeRecording('take.wav', 'the audio')
    const { meta } = await store.ingestFile(filepath, { docUrl: DOC_A })

    await rename(filepath, path.join(workspace, 'My first tape.wav'))

    expect(await store.has(meta.hash)).toBe(true)
    const streamed = await streamToString(store.read(meta.hash))
    expect(streamed).toBe('the audio')
  })

  it('dedups identical content from two different files', async () => {
    const store = createBlobStore(root)
    const first = await writeRecording('one.wav', 'same bytes')
    const second = await writeRecording('two.wav', 'same bytes')

    const a = await store.ingestFile(first, { docUrl: DOC_A })
    const b = await store.ingestFile(second, { docUrl: DOC_B })

    expect(b.deduped).toBe(true)
    expect(b.meta.hash).toBe(a.meta.hash)
    expect(await store.refs(a.meta.hash)).toEqual([DOC_A, DOC_B])
    const shard = a.meta.hash.slice(0, 2)
    expect(await readdir(path.join(root, 'objects', shard))).toHaveLength(1)
  })

  it('falls back to a copy when the filesystem will not link', async () => {
    // CI has no second filesystem, so EXDEV is injected.
    const store = createBlobStore(root, {
      link: async () => {
        const error: NodeJS.ErrnoException = new Error('cross-device link')
        error.code = 'EXDEV'
        throw error
      },
    })
    const filepath = await writeRecording('take.wav', 'the audio')

    const result = await store.ingestFile(filepath, { docUrl: DOC_A })

    expect(result.mode).toBe('copy')
    expect((await stat(filepath)).nlink).toBe(1)
    expect(await streamToString(store.read(result.meta.hash))).toBe('the audio')
  })
})

describe('ingestStream', () => {
  it('hashes the uploaded bytes and stores them', async () => {
    const store = createBlobStore(root)

    const { meta, deduped } = await store.ingestStream(
      Readable.from([Buffer.from('streamed audio')]),
      { mimeType: 'audio/mp4', docUrl: DOC_A },
    )

    expect(deduped).toBe(false)
    expect(meta.hash).toBe(sha256('streamed audio'))
    expect(meta.size).toBe('streamed audio'.length)
    expect(meta.ext).toBe('.mp4')
    expect(await streamToString(store.read(meta.hash))).toBe('streamed audio')
  })

  it('rejects an oversized upload and leaves no temp file behind', async () => {
    const store = createBlobStore(root)

    await expect(
      store.ingestStream(Readable.from([Buffer.alloc(64)]), {
        mimeType: 'audio/mp4',
        docUrl: DOC_A,
        maxBytes: 16,
      }),
    ).rejects.toBeInstanceOf(BlobTooLargeError)

    expect(await readdir(path.join(root, 'tmp'))).toEqual([])
  })
})

describe('refcounting', () => {
  it('keeps the object until the last owner releases it', async () => {
    const store = createBlobStore(root)
    const filepath = await writeRecording('take.wav', 'shared audio')
    const { meta } = await store.ingestFile(filepath, { docUrl: DOC_A })
    await store.addRef(meta.hash, DOC_B)

    const first = await store.releaseRef(meta.hash, DOC_A)
    expect(first.removed).toBe(false)
    expect(await store.has(meta.hash)).toBe(true)

    const second = await store.releaseRef(meta.hash, DOC_B)
    expect(second.removed).toBe(true)
    expect(await store.has(meta.hash)).toBe(false)
    expect(await store.stat(meta.hash)).toBeNull()
  })

  it('ignores a release from a document that never held a ref', async () => {
    const store = createBlobStore(root)
    const filepath = await writeRecording('take.wav', 'audio')
    const { meta } = await store.ingestFile(filepath, { docUrl: DOC_A })

    const result = await store.releaseRef(meta.hash, 'automerge:stranger')

    expect(result.removed).toBe(false)
    expect(await store.has(meta.hash)).toBe(true)
  })

  it('does not lose refs added concurrently', async () => {
    const store = createBlobStore(root)
    const filepath = await writeRecording('take.wav', 'audio')
    const { meta } = await store.ingestFile(filepath, { docUrl: DOC_A })

    const docs = Array.from(
      { length: 12 },
      (_, index) => `automerge:doc-${index}`,
    )
    await Promise.all(docs.map((doc) => store.addRef(meta.hash, doc)))

    expect((await store.refs(meta.hash)).sort()).toEqual(
      [DOC_A, ...docs].sort(),
    )
  })
})

describe('housekeeping', () => {
  it('reports the total bytes held', async () => {
    const store = createBlobStore(root)
    await store.ingestStream(Readable.from([Buffer.alloc(100)]), {
      mimeType: 'audio/mp4',
      docUrl: DOC_A,
    })
    await store.ingestStream(Readable.from([Buffer.alloc(50, 1)]), {
      mimeType: 'audio/mp4',
      docUrl: DOC_B,
    })

    expect(await store.totalBytes()).toBe(150)
  })

  it('sweeps only stale temp files', async () => {
    const store = createBlobStore(root)
    // Create the tmp dir via a real ingest, then plant an abandoned upload.
    await store.ingestStream(Readable.from([Buffer.from('x')]), {
      mimeType: 'audio/mp4',
      docUrl: DOC_A,
    })
    const stale = path.join(root, 'tmp', 'abandoned')
    await writeFile(stale, 'partial')
    const fresh = path.join(root, 'tmp', 'in-flight')
    await writeFile(fresh, 'partial')
    const { utimes } = await import('fs/promises')
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await utimes(stale, old, old)

    const removed = await store.sweepTmp(24 * 60 * 60 * 1000)

    expect(removed).toBe(1)
    expect(await readdir(path.join(root, 'tmp'))).toEqual(['in-flight'])
  })
})

describe('listObjects', () => {
  it('reports every object with its hardlink count', async () => {
    const store = createBlobStore(root)
    const filepath = await writeRecording('kept.wav', 'hardlinked bytes')
    const { meta } = await store.ingestFile(filepath, { docUrl: DOC_A })
    await store.ingestStream(Readable.from(['uploaded bytes']), {
      mimeType: 'audio/mp4',
      docUrl: DOC_B,
    })

    const objects = await store.listObjects()

    expect(objects).toHaveLength(2)
    const hardlinked = objects.find((object) => object.hash === meta.hash)
    // The user's own copy shares the inode, so unlinking the store's link
    // would not free these bytes.
    expect(hardlinked?.nlink).toBe(2)
    expect(hardlinked?.size).toBe('hardlinked bytes'.length)
    const uploaded = objects.find((object) => object.hash !== meta.hash)
    expect(uploaded?.nlink).toBe(1)
  })

  it('is empty for a store that has never been written to', async () => {
    expect(await createBlobStore(root).listObjects()).toEqual([])
  })
})

describe('remove', () => {
  it('unlinks an object the refcount could never free', async () => {
    const store = createBlobStore(root)
    const { meta } = await store.ingestStream(Readable.from(['orphaned']), {
      mimeType: 'audio/mp4',
      docUrl: DOC_A,
    })

    // Still owned: `releaseRef` would refuse, which is the whole reason this
    // exists.
    expect(await store.remove(meta.hash)).toBe(true)

    expect(await store.has(meta.hash)).toBe(false)
    expect(await store.stat(meta.hash)).toBeNull()
    expect(await store.refs(meta.hash)).toEqual([])
  })

  it('reports nothing removed for a hash the store does not hold', async () => {
    const store = createBlobStore(root)
    expect(await store.remove(sha256('never stored'))).toBe(false)
  })

  it('ignores a malformed hash rather than touching the filesystem', async () => {
    const store = createBlobStore(root)
    expect(await store.remove('../../etc/passwd')).toBe(false)
  })
})

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}
