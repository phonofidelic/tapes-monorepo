/**
 * THROWAWAY (TAP-218). Browser-only helpers shared by the three pages: the
 * worker-backed KDF, where this origin keeps its person key, saving a file,
 * and drawing and reading QR codes.
 */

import { keyFingerprint } from '@tapes-monorepo/provenance'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import type { KdfParams } from './kdf'
import type { KdfRequest, KdfResponse } from './kdfWorker'
import type { PersonKey } from './wrap'

// ---------- KDF in a worker ----------

let worker: Worker | undefined
let nextId = 1
const pending = new Map<number, (response: KdfResponse) => void>()

function kdfWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./kdfWorker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<KdfResponse>) => {
      pending.get(event.data.id)?.(event.data)
      pending.delete(event.data.id)
    }
  }
  return worker
}

/** Same signature as deriveBytes, plus the time spent inside the worker. */
export async function deriveInWorker(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  return (await deriveTimed(passphrase, salt, params)).bytes
}

export function deriveTimed(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: KdfParams,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; ms: number }> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, (response) =>
      response.ok
        ? resolve({ bytes: response.bytes, ms: response.ms })
        : reject(new Error(response.error)),
    )
    kdfWorker().postMessage({
      id,
      passphrase,
      salt,
      params,
    } satisfies KdfRequest)
  })
}

// ---------- This origin's person key ----------
// IndexedDB is per origin, exactly like the real guest's device key. Opening
// the page on a different IP or port shows an empty store.

const DB = 'tap218-prototype'
const STORE = 'keys'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export type StoredKey = PersonKey & { savedAt: string; how: string }

export function loadPersonKey(): Promise<StoredKey | undefined> {
  return tx('readonly', (store) => store.get('person'))
}

export async function savePersonKey(
  key: PersonKey,
  how: string,
): Promise<void> {
  const value: StoredKey = { ...key, savedAt: new Date().toISOString(), how }
  await tx('readwrite', (store) => store.put(value, 'person'))
}

export async function forgetPersonKey(): Promise<void> {
  await tx('readwrite', (store) => store.delete('person'))
}

export async function fingerprintOf(publicKeyText: string): Promise<string> {
  return (await keyFingerprint(publicKeyText)) ?? '?'
}

// ---------- Saving a file ----------

/**
 * Chrome's Web Share only accepts some extensions, and .json is not one of
 * them, so the file is plain text with a .txt name. The content is JSON.
 */
export function backupFile(text: string, fingerprint: string): File {
  return new File([text], `tapes-backup-${fingerprint}.txt`, {
    type: 'text/plain',
  })
}

export function canShareFile(file: File): boolean {
  return (
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  )
}

export async function shareFile(file: File): Promise<void> {
  await navigator.share({ files: [file], title: 'Tapes backup' })
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ---------- QR ----------

export type QrInfo = { dataUrl: string; version: number; modules: number }

/**
 * Error correction M survives some glare and a slightly blurry print. Byte
 * mode, because base64url is not in the QR alphanumeric set.
 */
export async function drawQr(text: string): Promise<QrInfo> {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const dataUrl = await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 4,
    scale: 8,
  })
  return { dataUrl, version: qr.version, modules: qr.modules.size }
}

/** Reads a QR from an image the person picked, such as a photo of a print. */
export async function readQrFromImage(file: Blob): Promise<string | undefined> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  // Large photos are slow to scan and gain nothing. Scale to about 1600 px.
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(image.data, image.width, image.height)?.data
}

type Detector = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

/**
 * Scans with the rear camera until a QR is found or stop() is called. Uses
 * the native BarcodeDetector where it exists, which is Chrome on Android.
 * iOS Safari has it off by default, so it falls back to jsQR there.
 */
export async function scanWithCamera(
  video: HTMLVideoElement,
  onFound: (text: string) => void,
): Promise<{ stop: () => void; engine: string }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  })
  video.srcObject = stream
  video.setAttribute('playsinline', '')
  await video.play()

  const BarcodeDetectorCtor = (
    globalThis as { BarcodeDetector?: new (o: object) => Detector }
  ).BarcodeDetector
  let detector: Detector | undefined
  if (BarcodeDetectorCtor) {
    try {
      detector = new BarcodeDetectorCtor({ formats: ['qr_code'] })
    } catch {
      detector = undefined
    }
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  let stopped = false
  const stop = () => {
    stopped = true
    stream.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  }

  const tick = async () => {
    if (stopped) return
    if (video.readyState >= 2) {
      let found: string | undefined
      if (detector) {
        found = (await detector.detect(video).catch(() => []))[0]?.rawValue
      } else {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        context.drawImage(video, 0, 0)
        const frame = context.getImageData(0, 0, canvas.width, canvas.height)
        found = jsQR(frame.data, frame.width, frame.height, {
          inversionAttempts: 'dontInvert',
        })?.data
      }
      if (found) {
        stop()
        onFound(found)
        return
      }
    }
    setTimeout(tick, 150)
  }
  tick()
  return { stop, engine: detector ? 'BarcodeDetector' : 'jsQR' }
}

// ---------- Small DOM helpers ----------

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

export function show(id: string, visible = true): void {
  $(id).hidden = !visible
}

/** A tiny event log on each page, so a tester can read back what happened. */
export function log(message: string): void {
  const line = `${new Date().toLocaleTimeString()}  ${message}`
  const el = document.getElementById('log')
  if (el) el.textContent = `${line}\n${el.textContent ?? ''}`
  console.log(line)
}
