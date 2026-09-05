/**
 * URL parsing for the app's two custom schemes.
 *
 * Both are registered as privileged in `main.ts`. The blob scheme is also
 * standard, so Chromium normalises its urls before a handler sees them: the
 * authority is lowercased and an authority-only url gains a trailing slash.
 * Stripping the scheme prefix by hand no longer round-trips, so both handlers
 * parse with `URL` instead.
 */

/**
 * The single opaque target a custom-scheme url carries: the authority and path
 * rejoined, minus the trailing slash that normalisation adds to an
 * authority-only url.
 */
function target(rawUrl: string): string {
  const url = new URL(rawUrl)
  const pathname = url.host && url.pathname === '/' ? '' : url.pathname
  const encoded = url.host + pathname
  try {
    return decodeURIComponent(encoded)
  } catch {
    // A lone `%` in a filename is not a valid escape; the raw form is the
    // best guess left, and is what the old prefix-stripping produced.
    return encoded
  }
}

/**
 * The filesystem path in a `tapes://` url.
 *
 * The path is absolute, so the url is `tapes:///Users/...`, with an empty
 * authority and the path verbatim. This is why the scheme is not standard.
 * Standard parsing would promote the first segment to a lowercased host and
 * drop the leading slash, leaving a relative path no file read can open.
 */
export function filepathFromTapesUrl(rawUrl: string): string {
  return target(rawUrl)
}

/**
 * The content hash in a `tapes-blob://<hash>` url. The hash is lowercase hex
 * and carries no path, so the authority lowercasing a `standard` scheme does
 * is a no-op here.
 */
export function hashFromTapesBlobUrl(rawUrl: string): string {
  return target(rawUrl)
}
