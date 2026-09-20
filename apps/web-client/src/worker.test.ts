/**
 * Runs the real worker module against a fake OPFS. What is under test is the
 * reply contract: every handler echoes the request id it was given, which is
 * what lets two requests be in flight at once.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

type WorkerReply = {
  type: string
  requestId?: string
  success: boolean
  payload?: Record<string, unknown>
  error?: string
}

/** One OPFS file, plus a gate the test opens to let a read of it finish. */
type Entry = {
  bytes: Uint8Array<ArrayBuffer>
  opened: Promise<void>
  open: () => void
}

const replies: WorkerReply[] = []
const objectUrls = new Map<string, Blob>()
const files = new Map<string, Entry>()

/** Set by a test to make OPFS itself unavailable, as a private window does. */
let storageFailure: Error | null = null

function addFile(name: string, contents: string, gated = false): Entry {
  let open = () => {}
  const opened = gated
    ? new Promise<void>((resolve) => {
        open = resolve
      })
    : Promise.resolve()
  const entry = {
    bytes: new TextEncoder().encode(contents),
    opened,
    open,
  }
  files.set(name, entry)
  return entry
}

const accessHandleFor = (entry: Entry) => ({
  getSize: () => entry.bytes.byteLength,
  read: (view: DataView, { at }: { at: number }) => {
    const target = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    target.set(entry.bytes.subarray(at, at + view.byteLength))
    return view.byteLength
  },
  write: () => 0,
  truncate: () => {},
  flush: () => {},
  close: () => {},
})

const root = {
  getFileHandle: async (name: string, options?: { create?: boolean }) => {
    let entry = files.get(name)
    if (!entry) {
      if (!options?.create) {
        throw new DOMException(`no such file: ${name}`, 'NotFoundError')
      }
      entry = addFile(name, '')
    }
    await entry.opened
    return {
      name,
      createSyncAccessHandle: async () => accessHandleFor(entry),
      getFile: async () => new File([entry.bytes], name),
    }
  },
}

type WorkerGlobals = {
  self: unknown
  postMessage: (data: WorkerReply) => void
  onmessage: (event: { data: unknown }) => void
}

const globals = globalThis as unknown as WorkerGlobals

const send = (type: string, payload: Record<string, unknown>) => {
  globals.onmessage({ data: { type, payload } })
}

/** Lets the worker's awaits run out before the test looks at the replies. */
const settle = async () => {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve()
  }
}

const replyFor = (requestId: string) =>
  replies.find((reply) => reply.requestId === requestId)

const textOf = (reply: WorkerReply | undefined) => {
  const url = reply?.payload?.url as string
  return objectUrls.get(url)?.text() ?? Promise.resolve('')
}

beforeAll(async () => {
  globals.self = globals
  // The module assigns to the bare `onmessage` global, which only a worker
  // scope declares. Without it the assignment is a strict-mode ReferenceError.
  globals.onmessage = () => {}
  globals.postMessage = (data: WorkerReply) => {
    replies.push(data)
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      storage: {
        getDirectory: async () => {
          if (storageFailure) {
            throw storageFailure
          }
          return root
        },
      },
    },
  })
  let nextUrl = 0
  URL.createObjectURL = (blob: Blob) => {
    nextUrl += 1
    const url = `blob:fake/${nextUrl}`
    objectUrls.set(url, blob)
    return url
  }
  // Assigns the module's `onmessage` handler onto the global.
  await import('./worker')
})

beforeEach(() => {
  replies.length = 0
  files.clear()
  objectUrls.clear()
  storageFailure = null
})

describe('request ids', () => {
  // The bug this protocol change exists to make impossible: two reads matched
  // by message type alone, where the first reply satisfies both callers.
  it('gives two overlapping reads their own file', async () => {
    const slow = addFile('first.webm', 'first take', true)
    const fast = addFile('second.webm', 'second take', true)

    send('storage:get', { filename: 'first.webm', requestId: 'one' })
    send('storage:get', { filename: 'second.webm', requestId: 'two' })
    await settle()
    expect(replies).toHaveLength(0)

    // Answer out of order, as a worker reading two files would.
    fast.open()
    await settle()
    slow.open()
    await settle()

    expect(replies).toHaveLength(2)
    await expect(textOf(replyFor('one'))).resolves.toBe('first take')
    await expect(textOf(replyFor('two'))).resolves.toBe('second take')
  })

  it('echoes the request id when a read misses', async () => {
    send('storage:get', { filename: 'gone.webm', requestId: 'one' })
    await settle()

    expect(replies).toEqual([
      {
        type: 'storage:get:response',
        requestId: 'one',
        success: false,
        payload: undefined,
        error: `no such file: gone.webm`,
      },
    ])
  })

  it('replies to a recording start with the filename it opened', async () => {
    send('recorder:start', {
      audioFormat: 'webm',
      audioInputDeviceId: 'default',
      requestId: 'one',
    })
    await settle()

    const reply = replyFor('one')
    expect(reply?.type).toBe('recorder:start:response')
    expect(reply?.success).toBe(true)
    expect(reply?.payload?.filename).toMatch(/\.webm$/)
  })

  it('replies to a recording stop', async () => {
    send('recorder:stop', { requestId: 'one' })
    await settle()

    expect(replyFor('one')).toMatchObject({
      type: 'recorder:stop:response',
      success: true,
    })
  })

  // Everything below is the same guarantee from the other side: a caller in
  // core waits on the reply and on nothing else, so silence is a hang.
  it('answers when the storage directory cannot be opened', async () => {
    storageFailure = new DOMException('denied', 'SecurityError')

    send('storage:get', { filename: 'first.webm', requestId: 'one' })
    await settle()

    expect(replyFor('one')).toMatchObject({ success: false, error: 'denied' })
  })

  it('answers a message type it does not handle', async () => {
    send('storage:teleport', { requestId: 'one' })
    await settle()

    expect(replyFor('one')).toMatchObject({
      success: false,
      error: 'unknown message type: storage:teleport',
    })
  })

  // The one handler that answers nothing, by design.
  it('sends no reply to a chunk write', async () => {
    send('recorder:start', {
      audioFormat: 'webm',
      audioInputDeviceId: 'default',
      requestId: 'one',
    })
    await settle()
    replies.length = 0

    send('recorder:write', { chunk: new Blob(['audio']) })
    await settle()

    expect(replies).toEqual([])
  })
})
