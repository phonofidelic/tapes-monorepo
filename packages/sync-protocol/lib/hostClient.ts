/**
 * How a host's own window says so when it opens the sync socket.
 *
 * The embedded sync server is a peer to the app window that hosts it, so the
 * host's own client shows up in its connection list next to the guests. It
 * marks itself here, on the same upgrade request that carries the pairing
 * token and the device name, so the host has the answer before any document
 * traffic.
 *
 * The claim is only ever a hint about which row is this machine. It grants
 * nothing, and a guest could send it, so a host that acts on it should also
 * require the connection to come from loopback.
 */

/** Query parameter carrying the claim, next to `t` and `d`. */
export const HOST_CLIENT_PARAM = 'h'

const HOST_CLIENT_VALUE = '1'

/** Marks a sync url as the one a host's own window connects on. */
export function withHostClientMarker(url: string): string {
  const marked = new URL(url)
  marked.searchParams.set(HOST_CLIENT_PARAM, HOST_CLIENT_VALUE)
  return marked.toString()
}

/** Whether an upgrade request's url carries the claim. */
export function hasHostClientMarker(url: URL): boolean {
  return url.searchParams.get(HOST_CLIENT_PARAM) === HOST_CLIENT_VALUE
}
