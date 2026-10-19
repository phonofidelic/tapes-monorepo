/** THROWAWAY (TAP-218). The restore flow: read a backup, unwrap, save it. */

import '../style.css'
import {
  $,
  deriveInWorker,
  fingerprintOf,
  loadPersonKey,
  log,
  readQrFromImage,
  savePersonKey,
  scanWithCamera,
  show,
} from '../browser'
import { parseBackupText, type Backup } from '../format'
import { describeKdf } from '../kdf'
import { toBase64Url } from '@tapes-monorepo/provenance'
import { unwrapPersonKey } from '../wrap'

const pageOpened = performance.now()
let backup: Backup | undefined
let stopCamera: (() => void) | undefined
let attempts = 0

$('origin').textContent = location.host

async function showCurrent() {
  const stored = await loadPersonKey()
  $('current').innerHTML = stored
    ? `identity <span class="fp">${await fingerprintOf(stored.publicKeyText)}</span> (${stored.how})`
    : 'no identity yet'
}

async function accept(text: string, source: string) {
  const parsed = parseBackupText(text)
  if (!parsed.ok) {
    $('found').innerHTML = `<span class="bad">${parsed.error}</span>`
    log(`${source}: rejected (${parsed.error})`)
    return
  }
  backup = parsed.backup
  const fp = await fingerprintOf(toBase64Url(backup.publicKey))
  $('found').innerHTML =
    `Found backup for identity <span class="fp">${fp}</span>. <span class="muted">${describeKdf(backup.kdf)}</span>`
  log(
    `${source}: backup for ${fp} after ${Math.round((performance.now() - pageOpened) / 1000)} s`,
  )
  show('step2')
  $('passphrase').focus()
}

$('scan').onclick = async () => {
  show('video')
  show('stopScan')
  try {
    const scanner = await scanWithCamera(
      $<HTMLVideoElement>('video'),
      (text) => {
        show('video', false)
        show('stopScan', false)
        accept(text, 'camera')
      },
    )
    stopCamera = scanner.stop
    log(`camera started (${scanner.engine})`)
  } catch (error) {
    show('video', false)
    show('stopScan', false)
    $('found').innerHTML =
      `<span class="bad">Camera unavailable: ${error}</span>`
    log(`camera failed: ${error}`)
  }
}
$('stopScan').onclick = () => {
  stopCamera?.()
  show('video', false)
  show('stopScan', false)
}

// One picker for both a backup file and a photo or screenshot of the QR.
$<HTMLInputElement>('pick').onchange = async (event) => {
  const picked = (event.target as HTMLInputElement).files?.[0]
  if (!picked) return
  if (picked.type.startsWith('image/')) {
    const text = await readQrFromImage(picked)
    if (!text) {
      $('found').innerHTML =
        '<span class="bad">No QR code found in that image.</span>'
      log('image: no QR found')
      return
    }
    accept(text, 'image')
  } else {
    accept(await picked.text(), 'file')
  }
}

$('usePaste').onclick = () =>
  accept($<HTMLTextAreaElement>('paste').value, 'paste')

$('unlock').onclick = async () => {
  if (!backup) return
  attempts++
  $('result').textContent = 'Unlocking…'
  $<HTMLButtonElement>('unlock').disabled = true
  const start = performance.now()
  const result = await unwrapPersonKey(
    backup,
    $<HTMLInputElement>('passphrase').value,
    deriveInWorker,
  )
  const ms = Math.round(performance.now() - start)
  $<HTMLButtonElement>('unlock').disabled = false
  if (!result.ok) {
    $('result').innerHTML =
      result.error === 'wrong-passphrase'
        ? '<span class="bad">That passphrase does not open this backup.</span>'
        : '<span class="bad">This backup is damaged.</span>'
    log(`unlock attempt ${attempts} failed (${result.error}) in ${ms} ms`)
    return
  }
  await savePersonKey(result.key, 'restored')
  const fp = await fingerprintOf(result.key.publicKeyText)
  const total = Math.round((performance.now() - pageOpened) / 1000)
  $('result').innerHTML =
    `<span class="ok">Restored identity <span class="fp">${fp}</span>.</span> Unlock took ${ms} ms. ${attempts} attempt(s), ${total} s on this page.`
  log(
    `restored ${fp}: unlock ${ms} ms, ${attempts} attempt(s), ${total} s on page`,
  )
  showCurrent()
}

showCurrent()
