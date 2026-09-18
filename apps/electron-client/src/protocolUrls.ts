/**
 * URL parsing for the `tapes-blob://` scheme, which addresses audio by content
 * hash.
 *
 * The scheme is registered as standard in `main.ts`, so Chromium normalises
 * its urls before a handler sees them: the authority is lowercased and an
 * authority-only url gains a trailing slash. Stripping the scheme prefix by
 * hand does not round-trip, so parse with `URL` instead.
 */

/**
 * The content hash in a `tapes-blob://<hash>` url. The hash is lowercase hex,
 * so neither the authority lowercasing nor percent-encoding changes it.
 */
export function hashFromTapesBlobUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  // Normalisation adds a trailing slash to an authority-only url.
  const pathname = url.host && url.pathname === '/' ? '' : url.pathname
  return url.host + pathname
}
