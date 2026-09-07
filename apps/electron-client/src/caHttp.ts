import type http from 'http'
// The pairing link's own reader, imported from core's source rather than its
// bundle: the bundle is the React app, and this is the main process. The file
// is dependency-free on purpose, so taking it directly costs nothing and keeps
// one definition of what counts as a fingerprint on both ends of the link.
import {
  decodeFingerprint,
  formatFingerprint,
  PAIRING_FINGERPRINT_PARAM,
} from '../../../packages/core/app/pairing'
import { fingerprintFromPem } from './certFingerprint'
import { CORS_HEADERS, sendJson } from './httpResponses'

/**
 * The two routes a guest needs before it can trust this host over TLS:
 * `/ca.crt` hands back the root certificate, and `/trust` is a plain page that
 * links to it and says how to install it on the device asking.
 *
 * Neither takes the pairing token. The root certificate is public by design —
 * it is what every guest is meant to hold — and the token adds nothing to a
 * document whose whole purpose is to be handed out. Requiring it would also
 * make the flow worse, since the first hop to a host a guest does not yet
 * trust is exactly the hop where the token is least likely to survive.
 *
 * Like `/blobs` and `/events`, both must stay mounted ahead of the static
 * handler. Its SPA fallback answers any unmatched path with index.html and a
 * 200, so a browser asking for `/ca.crt` would be handed HTML and try to
 * install it as a certificate.
 *
 * The root's private key is never read here. This module only ever sees the
 * certificate PEM, which the caller loads separately from the key.
 *
 * `/trust` also takes an optional `fp`, the fingerprint the pairing link
 * carries. Everything else on this page arrived over the connection nothing
 * has vouched for yet, so it proves nothing on its own; that value was scanned
 * off the host's own screen in the same room. Given both, the page compares
 * them so the person does not have to walk back to the host and read 64
 * characters by eye. The QR is unchanged: it still points at the app, and
 * whatever sends someone here appends the `fp` it was opened with.
 */

export const CA_CERT_PATH = '/ca.crt'
export const TRUST_PAGE_PATH = '/trust'

/**
 * iOS and Android both key off this type to offer a certificate install rather
 * than a download. `application/x-pem-file` gets a save-to-Files sheet on iOS
 * instead of the profile prompt.
 */
export const CA_CERT_CONTENT_TYPE = 'application/x-x509-ca-cert'

export type CaHandlerOptions = {
  /**
   * The host's root certificate PEM, or undefined when the server is not
   * running over TLS and there is nothing to trust. The routes stay mounted
   * either way so they never fall through to the SPA fallback.
   */
  rootCertPem?: string
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * The install steps, one entry per platform the detection script can name.
 * Every platform's steps are rendered, and the script only decides which one
 * starts open, so the page still works with scripting off and a guest on a
 * platform we guessed wrong can read the right steps anyway.
 */
const PLATFORMS: Array<{ id: string; title: string; steps: string[] }> = [
  {
    id: 'ios',
    title: 'iPhone or iPad',
    steps: [
      'Tap <strong>Download the certificate</strong> above and allow the profile download.',
      'Open <strong>Settings</strong>. Near the top, tap <strong>Profile Downloaded</strong>, then <strong>Install</strong>.',
      // Skipping this leaves the root installed but not trusted for TLS, and
      // the browser warning looks exactly as it did before the install.
      'Go to <strong>Settings &rsaquo; General &rsaquo; About &rsaquo; Certificate Trust Settings</strong> and switch <strong>Tapes Host CA</strong> on.',
      'The second step is the one that matters. Without it the certificate is installed but not trusted, and you will still see the warning.',
    ],
  },
  {
    id: 'android',
    title: 'Android',
    steps: [
      'Tap <strong>Download the certificate</strong> above.',
      'Open <strong>Settings &rsaquo; Security &rsaquo; Encryption and credentials &rsaquo; Install a certificate &rsaquo; CA certificate</strong>, then pick the downloaded file.',
      'Chrome trusts it from then on.',
      'Firefox does not use the system store, so it keeps showing the warning. Use Chrome, or take the click-through below.',
    ],
  },
  {
    id: 'macos',
    title: 'Mac',
    steps: [
      'Click <strong>Download the certificate</strong> above, then double-click the downloaded file to add it to your login keychain.',
      'In <strong>Keychain Access</strong>, find <strong>Tapes Host CA</strong>, open it, expand <strong>Trust</strong>, and set <strong>Secure Sockets Layer (SSL)</strong> to <strong>Always Trust</strong>.',
    ],
  },
  {
    id: 'other',
    title: 'Something else',
    steps: [
      'Add the downloaded certificate to your system or browser trust store as a certificate authority.',
      'If you would rather not install anything, go back to the pairing link and accept the browser warning instead. That trusts this one connection and nothing else, and you will be asked again on the next visit.',
    ],
  },
]

function renderPlatform(platform: (typeof PLATFORMS)[number]) {
  const steps = platform.steps
    .map((step) => `      <li>${step}</li>`)
    .join('\n')
  return `  <details data-platform="${platform.id}">
    <summary>${escapeHtml(platform.title)}</summary>
    <ol>
${steps}
    </ol>
  </details>`
}

/**
 * What the page can say about the root it is offering.
 *
 * `unchecked` covers every case where there is nothing to compare: no `fp` in
 * the link, a value that is not a fingerprint, or a host with no certificate
 * yet. All three fall back to asking the person to compare by eye, which is
 * what the page said before it could compare anything, and is still correct.
 */
type Comparison = 'unchecked' | 'match' | 'mismatch'

/**
 * Compares what this host is offering against what the pairing link named.
 * Both sides are normalized to lowercase hex first: this page prints uppercase
 * colon-separated pairs and the link carries base64url, so the raw strings
 * never match even when the certificates do.
 */
function compareFingerprints(
  servedFingerprint: string | null,
  linkFingerprint: string | null,
): Comparison {
  if (!servedFingerprint || !linkFingerprint) {
    return 'unchecked'
  }
  const served = decodeFingerprint(servedFingerprint)
  const fromLink = decodeFingerprint(linkFingerprint)
  if (!served || !fromLink) {
    return 'unchecked'
  }
  return served === fromLink ? 'match' : 'mismatch'
}

/**
 * The block above the install steps: what the person is being asked to check,
 * and how much of it the page has already checked for them.
 */
function renderVerdict(
  verdict: Comparison,
  servedFingerprint: string | null,
  linkFingerprint: string | null,
): string {
  if (verdict === 'match') {
    return `<div class="fingerprint match">
  <strong>Checked.</strong> This host is offering the certificate the pairing
  link names, so it is the computer whose screen you scanned. Go ahead and
  install it.
  <code>${escapeHtml(servedFingerprint ?? '')}</code>
</div>`
  }

  if (verdict === 'mismatch') {
    return `<div class="fingerprint stop">
  <strong>Stop. Do not install this certificate.</strong> It is not the one the
  pairing link names, which means something other than the host answered this
  connection. Nothing here is safe to install. Go back to the host computer,
  check the fingerprint in its Sync settings, and scan the code again.
  <span class="label">In the link you scanned</span>
  <code>${escapeHtml(
    formatFingerprint(decodeFingerprint(linkFingerprint ?? '') ?? ''),
  )}</code>
  <span class="label">Offered by this connection</span>
  <code>${escapeHtml(servedFingerprint ?? '')}</code>
</div>`
  }

  return `<div class="fingerprint">
  <strong>Check this first.</strong> Open Tapes on the host computer and compare
  the fingerprint it shows with this one. If they differ, stop &mdash; something
  on the network answered instead of the host.
  <code>${servedFingerprint ? escapeHtml(servedFingerprint) : 'No certificate has been created on this host yet.'}</code>
</div>`
}

/**
 * The trust page. Self-contained on purpose: no bundle, no fonts, no images.
 * This is the page a guest reaches when TLS to this host is not working yet, so
 * anything it had to fetch is the thing most likely to fail.
 */
export function renderTrustPage(
  fingerprint: string | null,
  linkFingerprint: string | null = null,
): string {
  const verdict = compareFingerprints(fingerprint, linkFingerprint)

  // A mismatch is the one case where the page stops rather than warns. The
  // download and the install steps are what it is here to offer, so on a
  // mismatch it offers neither: there is nothing safe to do with a certificate
  // that is not the one the host showed.
  const stop = verdict === 'mismatch'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trust this host &middot; Tapes</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 34rem;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1rem; }
  .lede { opacity: .8; }
  .download {
    display: inline-block; padding: .7rem 1.1rem; margin: .25rem 0 1.5rem;
    border-radius: .5rem; background: #18181b; color: #fff;
    text-decoration: none; font-weight: 600;
  }
  @media (prefers-color-scheme: dark) {
    .download { background: #fafafa; color: #18181b; }
  }
  .fingerprint {
    margin: 0 0 1.5rem; padding: .75rem .9rem; border-radius: .5rem;
    border: 1px solid currentColor; opacity: .95;
  }
  .fingerprint code {
    display: block; margin-top: .4rem; word-break: break-all;
    font: .8rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .fingerprint .label { display: block; margin-top: .75rem; font-size: .8rem; opacity: .8; }
  /* Colour is the second signal, never the only one: both states say what they
     mean in words first, for anyone who cannot tell these two apart. */
  .match { border-color: #15803d; }
  .stop { border-width: 2px; border-color: #b91c1c; }
  .stop strong { color: #b91c1c; }
  @media (prefers-color-scheme: dark) {
    .match { border-color: #4ade80; }
    .stop { border-color: #f87171; }
    .stop strong { color: #f87171; }
  }
  details { border-top: 1px solid rgba(128,128,128,.4); padding: .75rem 0; }
  summary { cursor: pointer; font-weight: 600; }
  ol { margin: .75rem 0 0; padding-left: 1.25rem; }
  li { margin-bottom: .5rem; }
</style>
</head>
<body>
${
  stop
    ? `<h1>Do not trust this host</h1>`
    : `<h1>Trust this host</h1>
<p class="lede">
  This computer signs its own connections. Installing its certificate once stops
  the browser warning on this device, and keeps it away even when the host moves
  to a different address on the network.
</p>`
}

${stop ? '' : `<p><a class="download" href="${CA_CERT_PATH}" download="tapes-host-ca.crt">Download the certificate</a></p>`}

${renderVerdict(verdict, fingerprint, linkFingerprint)}

${stop ? '' : PLATFORMS.map(renderPlatform).join('\n')}

<script>
  // Only chooses which section starts open. Every platform is on the page, so
  // a wrong guess costs a tap and nothing else.
  var ua = navigator.userAgent
  var id =
    /iPhone|iPad|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac; the touch points tell them apart.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? 'ios'
      : /Android/.test(ua)
        ? 'android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'macos'
          : 'other'
  var match = document.querySelector('details[data-platform="' + id + '"]')
  if (match) match.open = true
</script>
</body>
</html>
`
}

/**
 * Builds the route. Answers `/ca.crt` and `/trust`, declines everything else so
 * the next route and finally the static handler get a look.
 */
export function createCaRequestHandler(options: CaHandlerOptions = {}) {
  const { rootCertPem } = options
  const fingerprint = rootCertPem ? fingerprintFromPem(rootCertPem) : null

  return async function handleCaRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const pathname = url.pathname
    if (pathname !== CA_CERT_PATH && pathname !== TRUST_PAGE_PATH) {
      return false
    }

    request.resume()

    const method = request.method ?? 'GET'
    if (method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS)
      response.end()
      return true
    }
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { ...CORS_HEADERS, Allow: 'GET,HEAD,OPTIONS' })
      response.end()
      return true
    }

    if (pathname === TRUST_PAGE_PATH) {
      // Whatever sent the guest here forwards the `fp` the pairing link was
      // opened with. It is public by design, so it costs nothing to have it
      // in a URL, and the page is the only thing that reads it.
      const body = Buffer.from(
        renderTrustPage(
          fingerprint,
          url.searchParams.get(PAIRING_FINGERPRINT_PARAM),
        ),
        'utf-8',
      )
      response.writeHead(200, {
        ...CORS_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.byteLength,
        // The fingerprint changes if the root is ever replaced, and a stale
        // copy of this page would tell a guest to accept the wrong one.
        'Cache-Control': 'no-store',
      })
      response.end(method === 'HEAD' ? undefined : body)
      return true
    }

    if (!rootCertPem) {
      // Claim the path rather than declining it, exactly as the blob and event
      // stand-ins do, so it never falls through and returns the app shell.
      sendJson(response, 503, {
        error: 'This host is not running over HTTPS, so it has no certificate',
      })
      return true
    }

    const body = Buffer.from(rootCertPem, 'utf-8')
    response.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': CA_CERT_CONTENT_TYPE,
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
      // No Content-Disposition on purpose. The filename is already in the path,
      // and marking the response as an attachment sends iOS Safari to the Files
      // app instead of the configuration-profile prompt, which is the only way
      // to install a root there.
    })
    response.end(method === 'HEAD' ? undefined : body)
    return true
  }
}
