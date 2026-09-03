/**
 * URL parsing for the app's two custom schemes.
 *
 * Both are registered as privileged (see `registerSchemesAsPrivileged` in
 * `main.ts`), and `tapes-blob` is additionally `standard`, which means Chromium
 * parses and normalises its urls before a handler sees them: the authority is
 * lowercased and an authority-only url picks up a trailing slash. Stripping the
 * `scheme://` prefix by hand no longer round-trips, so both handlers go through
 * `URL` instead.
 */

/**
 * Splits a custom-scheme url back into the single opaque target it carries —
 * the authority and path rejoined, with the trailing slash normalisation adds
 * to an authority-only url removed again.
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
 * The path is absolute, so the url is `tapes:///Users/…`: an empty authority
 * and the path verbatim. This is why the scheme is deliberately *not*
 * `standard` — standard parsing rewrites that to `tapes://Users/…`, promoting
 * the first segment to a lowercased host and dropping the leading slash, which
 * leaves a relative path no `readFile` can open.
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
