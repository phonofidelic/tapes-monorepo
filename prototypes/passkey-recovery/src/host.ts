/**
 * THROWAWAY PROTOTYPE (TAP-217). Not production code.
 *
 * The host page, opened on the laptop. It shows a QR code for the guest page
 * and lists the recordings the stand-in host has checked. The QR code stands
 * in for the real pairing QR. It carries no pairing token.
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QRCodeSVG } from 'qrcode.react'

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T

const params = new URLSearchParams(location.search)
const originInput = $<HTMLInputElement>('origin')
const rpInput = $<HTMLInputElement>('rp')
originInput.value = params.get('origin') ?? location.origin
rpInput.value = params.get('rp') ?? location.hostname

const qr = createRoot($('qr'))

function guestUrl(): string {
  const url = new URL('/', originInput.value.trim())
  const rp = rpInput.value.trim()
  if (rp && rp !== url.hostname) {
    url.searchParams.set('rp', rp)
  }
  return url.toString()
}

function renderQr() {
  let url: string
  try {
    url = guestUrl()
  } catch {
    $('url').textContent = 'Not a valid origin'
    return
  }
  $('url').textContent = url
  qr.render(createElement(QRCodeSVG, { value: url, size: 240, marginSize: 2 }))
}

async function renderClaims() {
  const claims = (await (await fetch('/proto-api/claims')).json()) as {
    at: string
    device: string
    verdict: string
  }[]
  $('claims').innerHTML = claims
    .map(
      (c) =>
        `<tr><td>${c.at.slice(11, 19)}</td><td>${c.device}</td><td>${c.verdict}</td></tr>`,
    )
    .join('')
}

originInput.addEventListener('input', renderQr)
rpInput.addEventListener('input', renderQr)
$('reset').addEventListener('click', async () => {
  if (confirm('Forget all stored keys, certificates and recordings?')) {
    await fetch('/proto-api/reset', { method: 'POST' })
    await renderClaims()
  }
})

renderQr()
renderClaims()
setInterval(renderClaims, 2000)
