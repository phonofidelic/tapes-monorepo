/**
 * THROWAWAY (TAP-218). Times each KDF setting on this device. Run it on a
 * mid-range phone and paste the copied results into the ticket.
 */

import '../style.css'
import { $, deriveTimed, log, show } from '../browser'
import { BENCH_SETTINGS, summarize } from '../bench'
import { describeKdf } from '../kdf'

$('ua').textContent = navigator.userAgent
let report = ''

$('run').onclick = async () => {
  const runs = Number($<HTMLSelectElement>('runs').value)
  $<HTMLButtonElement>('run').disabled = true
  $('rows').innerHTML = ''
  const lines = [
    `TAP-218 KDF benchmark, ${new Date().toISOString()}`,
    navigator.userAgent,
    '',
  ]
  for (const setting of BENCH_SETTINGS) {
    const label = `${describeKdf(setting.params)}${setting.proposed ? ' (proposed)' : ''}`
    const times: number[] = []
    let error = ''
    for (let i = 0; i < runs; i++) {
      $('status').textContent = `${label}: run ${i + 1} of ${runs}`
      try {
        const salt = crypto.getRandomValues(new Uint8Array(16))
        times.push(
          (
            await deriveTimed(
              'correct horse battery staple',
              salt,
              setting.params,
            )
          ).ms,
        )
      } catch (e) {
        error = String(e)
        break
      }
    }
    const row = document.createElement('tr')
    if (error) {
      row.innerHTML = `<td>${label}</td><td colspan="3" class="bad">${error}</td>`
      lines.push(`${label}: FAILED ${error}`)
    } else {
      const s = summarize(times)
      row.innerHTML = `<td>${label}</td><td class="num">${s.median}</td><td class="num">${s.min}</td><td class="num">${s.max}</td>`
      lines.push(
        `${label}: median ${s.median} ms, min ${s.min}, max ${s.max}, runs [${times.map(Math.round).join(', ')}]`,
      )
    }
    $('rows').append(row)
    log(lines[lines.length - 1])
  }
  report = lines.join('\n')
  $('status').textContent = 'Done. Times are in milliseconds.'
  $<HTMLButtonElement>('run').disabled = false
  show('copy')
}

$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(report)
    $('status').textContent = 'Copied.'
  } catch {
    $('status').textContent = 'Copy failed. Select the log below instead.'
  }
}
