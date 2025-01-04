export {}

declare global {
  interface DedicatedWorkerGlobalScope {
    fileHandle: FileSystemFileHandle | null
    accessHandle: FileSystemSyncAccessHandle | null
  }
}

type EventData =
  | {
      type: 'recorder:start'
      payload: {
        audioFormat: 'webm' | 'mp3'
        audioInputDeviceId: string
      }
    }
  | {
      type: 'recorder:write'
      payload: {
        chunk: Blob
      }
    }
  | {
      type: 'recorder:stop'
      payload: never
    }
  | {
      type: 'storage:get'
      payload: {
        filename: string
      }
    }

const ctx: DedicatedWorkerGlobalScope = self as any
ctx.fileHandle = null
ctx.accessHandle = null

onmessage = async (event) => {
  const { type, payload }: EventData = event.data

  switch (type) {
    case 'recorder:start': {
      const { audioFormat, audioInputDeviceId } = payload
      console.log('recorder:start', { audioFormat, audioInputDeviceId })
      try {
        const root = await navigator.storage.getDirectory()
        const fileHandle = await root.getFileHandle(
          `${crypto.randomUUID()}.${audioFormat}`,
          {
            create: true,
          },
        )
        ctx.fileHandle = fileHandle
        ctx.accessHandle = await fileHandle.createSyncAccessHandle()

        ctx.postMessage({
          type: 'recorder:start:response',
          payload: {
            message: 'recording started',
            filename: fileHandle.name,
          },
        })
      } catch (error) {
        console.error('error:', error)
        ctx.postMessage({
          type: 'recorder:start:error',
          payload: {
            message: 'error creating file',
            error,
          },
        })
      }

      break
    }
    case 'recorder:write': {
      const { chunk } = payload as { chunk: Blob }
      if (ctx.accessHandle) {
        try {
          ctx.accessHandle.write(await chunk.arrayBuffer())
          ctx.accessHandle.flush()
          ctx.accessHandle.close()
          ctx.accessHandle = null
        } catch (error) {
          console.error('error writing to file:', error)
        }
      }
      break
    }
    case 'recorder:stop': {
      if (ctx.accessHandle) {
        ctx.accessHandle.flush()
      }

      ctx.postMessage({
        type: 'recorder:stop:response',
        payload: { message: 'recording stopped' },
      })
      break
    }
    case 'storage:get': {
      const { filename } = payload
      const root = await navigator.storage.getDirectory()
      try {
        const handle = await root.getFileHandle(filename)
        const accessHandle = await handle.createSyncAccessHandle()
        const fileSize = accessHandle.getSize()
        const buffer = new DataView(new ArrayBuffer(fileSize))
        accessHandle.read(buffer, { at: 0 })

        const blob = new Blob([buffer], { type: 'audio/mp4' })
        const url = URL.createObjectURL(blob)
        ctx.postMessage({
          type: 'storage:get:response',
          success: true,
          payload: {
            message: 'file retrieved',
            url,
            blob,
          },
        })
        accessHandle.close()
      } catch (error) {
        console.error('error, event:', error)
        ctx.postMessage({
          type: 'storage:get:response',
          success: false,
          error,
          payload: {
            message: 'error retrieving file',
          },
        })
      }
      break
    }
    default:
      console.error('unknown message', event.data)
      break
  }
}
