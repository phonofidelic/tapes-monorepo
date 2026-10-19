/**
 * THROWAWAY PROTOTYPE (TAP-219). Not production code.
 *
 * The two HTML pages. The guest page loads its logic from `/guest.js`. The
 * operator page is small enough to keep its script inline.
 */

const style = `
  :root { color-scheme: light dark; --accent: #c2410c; --ok: #15803d; }
  * { box-sizing: border-box; }
  body { font: 17px/1.4 system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 720px; }
  h1 { font-size: 1.4rem; margin: 0 0 8px; }
  .card { border: 1px solid #8884; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .card.ok { border-color: var(--ok); }
  button { font: inherit; padding: 12px 16px; border-radius: 10px; border: 0; background: var(--accent); color: white; width: 100%; margin-top: 8px; cursor: pointer; }
  button.secondary { background: transparent; color: inherit; border: 1px solid #8886; }
  input { font: inherit; padding: 10px; width: 100%; border-radius: 8px; border: 1px solid #8886; margin-top: 4px; }
  label { display: block; margin-bottom: 12px; }
  .people { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .person { font-size: 1.2rem; padding: 20px 8px; }
  .muted { opacity: .7; font-size: .9rem; }
  .center { text-align: center; }
  .error { color: #dc2626; }
  code, pre { font-size: .8rem; overflow-x: auto; }
  .banner { background: #fde68a; color: #713f12; padding: 6px 10px; border-radius: 8px; font-size: .85rem; margin-bottom: 12px; }
`

const banner = `<div class="banner">Throwaway prototype for host vouching. Not the Tapes app.</div>`

export function guestPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tapes vouch prototype</title><style>${style}</style></head>
<body>${banner}<div id="app">Loading…</div><script src="/guest.js"></script></body></html>`
}

export function hostPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tapes vouch prototype: host</title>
<style>${style}
  .layout { display: grid; grid-template-columns: 260px 1fr; gap: 16px; }
  @media (max-width: 640px) { .layout { grid-template-columns: 1fr; } }
  .qr svg { background: white; padding: 8px; border-radius: 8px; width: 100%; height: auto; }
  .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; border-top: 1px solid #8883; padding: 10px 0; }
  .row button { width: auto; margin: 0; }
  .who { font-size: 1.2rem; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  td, th { text-align: left; padding: 4px; border-top: 1px solid #8883; }
</style></head>
<body>${banner}
<div class="layout">
  <div>
    <div class="card qr"><div id="qr"></div>
      <p class="muted">Host key <code id="fp"></code></p>
      <p class="muted" id="url"></p>
    </div>
    <button id="change">Origin changed: refresh QR</button>
    <p class="muted">Re-reads the LAN IP and moves to the next port. Every guest starts with an empty store, as after a real IP change.</p>
  </div>
  <div>
    <div class="card"><h1>Waiting to join</h1><div id="pending"><p class="muted">Nobody yet.</p></div>
      <button class="secondary" id="all">Confirm everyone listed</button>
      <p class="muted">Only after looking round the room. It is here to measure the band case.</p></div>
    <div class="card"><h1>People</h1><div id="people"></div></div>
    <div class="card"><h1>Vouches signed</h1><table id="log"></table></div>
    <button class="secondary" id="reset">Reset all prototype data</button>
  </div>
</div>
<script>
const $ = (id) => document.getElementById(id)
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
let lastQr = ''
let shown = []
async function refresh() {
  const s = await (await fetch('/host/api/state')).json()
  if (s.qr !== lastQr) { $('qr').innerHTML = s.qr; lastQr = s.qr }
  $('fp').textContent = s.hostFingerprint
  $('url').textContent = s.guestUrl + ' (origin changes: ' + s.originChanges + ')'
  shown = s.pending.map((p) => p.id)
  $('pending').innerHTML = s.pending.length ? s.pending.map((p) =>
    '<div class="row"><div><div class="who">' + esc(p.personName) + '</div>' +
    '<div class="muted">' + esc(p.deviceLabel) + ' · ' + esc(p.deviceFingerprint) + ' · ' +
    Math.round((Date.now() - Date.parse(p.receivedAt)) / 1000) + ' s ago</div></div>' +
    '<div style="display:flex;gap:8px"><button data-confirm="' + p.id + '">Yes, that\\'s ' + esc(p.personName) + '</button>' +
    '<button class="secondary" data-reject="' + p.id + '">No</button></div></div>').join('')
    : '<p class="muted">Nobody yet.</p>'
  $('people').innerHTML = s.people.map((p) =>
    '<div class="row"><span>' + esc(p.name) + (p.hasPin ? ' · has PIN' : '') + '</span>' +
    (p.pinLocked ? '<button class="secondary" data-unlock="' + esc(p.personKey) + '">Unlock PIN</button>' : '') + '</div>').join('') ||
    '<p class="muted">Nobody has joined yet.</p>'
  $('log').innerHTML = '<tr><th>Who</th><th>Device</th><th>How</th><th>Waited</th></tr>' +
    s.log.slice().reverse().map((l) => '<tr><td>' + esc(l.personName) + '</td><td>' + esc(l.deviceLabel) +
    '</td><td>' + l.method + '</td><td>' + (l.waitedMs / 1000).toFixed(1) + ' s</td></tr>').join('')
}
document.body.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return
  if (t.dataset.confirm) await post('/host/api/confirm', { id: t.dataset.confirm })
  if (t.dataset.reject) await post('/host/api/reject', { id: t.dataset.reject })
  if (t.dataset.unlock) await post('/host/api/unlock-pin', { personKey: t.dataset.unlock })
  if (t.id === 'all') for (const id of shown) await post('/host/api/confirm', { id })
  if (t.id === 'change') await post('/host/api/change-origin')
  if (t.id === 'reset' && confirm('Forget every person and vouch?')) await post('/host/api/reset')
  refresh()
})
refresh(); setInterval(refresh, 1000)
</script></body></html>`
}
