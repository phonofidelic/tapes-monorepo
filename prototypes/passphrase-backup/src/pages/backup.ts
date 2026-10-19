/** THROWAWAY (TAP-218). The export flow: create a key, wrap it, save it. */

import '../style.css'
import {
  $,
  backupFile,
  canShareFile,
  deriveInWorker,
  downloadFile,
  drawQr,
  fingerprintOf,
  loadPersonKey,
  log,
  savePersonKey,
  shareFile,
  show,
} from '../browser'
import { toCompact, toFileText, type Backup } from '../format'
import { describeKdf, PROPOSED_ARGON2ID, PROPOSED_PBKDF2 } from '../kdf'
import { generatePassphrase, normalizePassphrase } from '../passphrase'
import {
  generatePersonKey,
  unwrapPersonKey,
  wrapPersonKey,
  type PersonKey,
} from '../wrap'

let key: PersonKey | undefined
let backup: Backup | undefined
let file: File | undefined
let fingerprint = ''

$('origin').textContent = location.host

async function refreshKey() {
  const stored = await loadPersonKey()
  key = stored
  if (stored) {
    fingerprint = await fingerprintOf(stored.publicKeyText)
    $('keyStatus').innerHTML =
      `Identity <span class="fp">${fingerprint}</span>, ${stored.how} ${new Date(stored.savedAt).toLocaleString()}.`
    $('create').textContent = 'Replace with a new identity'
    $('create').className = 'secondary'
    show('step2')
  } else {
    $('keyStatus').textContent = 'No identity on this device yet.'
  }
}

$('create').onclick = async () => {
  if (key && !confirm('This replaces the identity on this device. Continue?'))
    return
  const fresh = await generatePersonKey()
  await savePersonKey(fresh, 'created')
  log('created a new identity')
  await refreshKey()
}

// ---------- Passphrase choice ----------

const mode = () =>
  (document.querySelector('input[name=mode]:checked') as HTMLInputElement).value
$('generated').textContent = generatePassphrase()
$('regenerate').onclick = () => {
  $('generated').textContent = generatePassphrase()
  log('asked for different words')
}
document.querySelectorAll('input[name=mode]').forEach((radio) => {
  radio.addEventListener('change', () => {
    show('generatedBox', mode() === 'generated')
    show('chosenBox', mode() === 'chosen')
    log(`passphrase mode: ${mode()}`)
  })
})

function chosenPassphrase(): string | undefined {
  const a = $<HTMLInputElement>('chosen').value
  const b = $<HTMLInputElement>('chosenAgain').value
  const words = normalizePassphrase(a).split(' ').filter(Boolean).length
  if (normalizePassphrase(a) !== normalizePassphrase(b)) {
    $('chosenHint').textContent = 'The two entries do not match.'
    return undefined
  }
  // A weak floor for a prototype. A real version would estimate strength.
  if (words < 4 && normalizePassphrase(a).length < 16) {
    $('chosenHint').textContent =
      'Too short. Use at least 4 words or 16 characters.'
    return undefined
  }
  return a
}

// ---------- Wrap and export ----------

$('makeBackup').onclick = async () => {
  if (!key) return
  const passphrase =
    mode() === 'generated'
      ? ($('generated').textContent ?? '')
      : chosenPassphrase()
  if (!passphrase) return
  const kdf =
    $<HTMLSelectElement>('kdf').value === 'pbkdf2'
      ? PROPOSED_PBKDF2
      : PROPOSED_ARGON2ID
  $('wrapStatus').textContent = `Locking with ${describeKdf(kdf)}…`
  $<HTMLButtonElement>('makeBackup').disabled = true
  const start = performance.now()
  try {
    backup = await wrapPersonKey(key, passphrase, kdf, deriveInWorker)
  } catch (error) {
    $('wrapStatus').textContent = `Failed: ${error}`
    $<HTMLButtonElement>('makeBackup').disabled = false
    return
  }
  const ms = Math.round(performance.now() - start)
  $('wrapStatus').textContent = `Locked in ${ms} ms (${describeKdf(kdf)}).`
  log(`wrapped with ${describeKdf(kdf)} in ${ms} ms, mode ${mode()}`)
  $<HTMLButtonElement>('makeBackup').disabled = false

  const compact = toCompact(backup)
  file = backupFile(toFileText(backup), fingerprint)
  $<HTMLTextAreaElement>('compact').value = compact
  const qr = await drawQr(compact)
  $<HTMLImageElement>('qr').src = qr.dataUrl
  $('qrInfo').textContent =
    `Identity ${fingerprint}. ${compact.length} characters, QR version ${qr.version} (${qr.modules}×${qr.modules}).`
  show('share', canShareFile(file))
  show('step3')
  show('step4')
}

$('share').onclick = async () => {
  if (!file) return
  try {
    await shareFile(file)
    log('shared file')
  } catch (error) {
    log(`share cancelled or failed: ${error}`)
  }
}
$('download').onclick = () => {
  if (!file) return
  downloadFile(file)
  log('downloaded file')
}
$('print').onclick = () => {
  log('printed')
  print()
}

// ---------- Recall check ----------
// Unwraps the backup just made with what the person types. This is the
// "verify early" step that Signal's PIN reminders and Element's issue tracker
// both point to.

$('checkButton').onclick = async () => {
  if (!backup) return
  $('checkStatus').textContent = 'Checking…'
  const result = await unwrapPersonKey(
    backup,
    $<HTMLInputElement>('check').value,
    deriveInWorker,
  )
  if (result.ok) {
    $('checkStatus').innerHTML =
      '<span class="ok">That is right. Your backup opens.</span>'
    log('recall check passed')
  } else {
    $('checkStatus').innerHTML =
      '<span class="bad">That does not match. Check your note.</span>'
    log('recall check failed')
  }
}

refreshKey()
