import '@testing-library/jest-dom/vitest'

// jsdom implements neither of these, and the player builds every source it
// plays through URL.createObjectURL. The fake keeps the Blob addressable so
// tests can assert on what was actually handed to the audio element.
const objectUrls = new Map<string, Blob>()
let nextObjectUrl = 0

if (!URL.createObjectURL) {
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:mock/${++nextObjectUrl}`
    objectUrls.set(url, blob)
    return url
  }
  URL.revokeObjectURL = (url: string) => {
    objectUrls.delete(url)
  }
}

export function blobForObjectUrl(url: string): Blob | undefined {
  return objectUrls.get(url)
}

// jsdom's Blob is missing the read methods every real browser has, and the
// blob cache reads bytes back out of one before storing them.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

if (!Blob.prototype.text) {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}

// jsdom implements no PointerEvent, so testing-library falls back to a bare
// Event and the coordinates never arrive — which is all a transport-bar drag
// is made of. MouseEvent carries clientX/clientY natively; only the pointer id
// has to be added.
if (!globalThis.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
    }
  }

  globalThis.PointerEvent =
    PointerEventPolyfill as unknown as typeof globalThis.PointerEvent
}
