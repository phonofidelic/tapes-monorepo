export type SyncServerInfo = {
  running: boolean
  url: string
  lanUrl?: string
  /** URL of the hosted web-client bundle, when one is being served. */
  webAppUrl?: string
  /** LAN-reachable URL of the hosted web-client bundle. */
  lanWebAppUrl?: string
  /** Origin serving `/blobs`, when the host has a blob store configured. */
  blobBaseUrl?: string
  /** LAN-reachable origin serving `/blobs`. */
  lanBlobBaseUrl?: string
  /**
   * Page that offers this host's root certificate and the steps to install it.
   * Present only when the server runs over TLS, since with plain HTTP there is
   * nothing for a guest to trust. The LAN one is what a guest can actually
   * open; the loopback one is for the host's own window.
   */
  trustPageUrl?: string
  lanTrustPageUrl?: string
  /**
   * Bearer token for `/blobs` and the sync socket. Never log this object
   * wholesale.
   */
  pairingToken?: string
  /**
   * SHA-256 of the host's root certificate, in colon-separated pairs, when the
   * sync server is running over TLS. Not a secret: unlike `pairingToken` it
   * grants nothing. Shown in Settings and carried in the pairing link so the person pairing can
   * check the root they install is this host's.
   */
  rootCertFingerprint?: string
  port: number
  host: string
}

/**
 * One device connected to a host's sync server.
 */
export type SyncConnection = {
  /** Stable for the life of the connection. Not a device identity. */
  id: string
  /**
   * The name the guest gave on the handshake, already sanitized. Undefined
   * when it sent nothing usable, so the UI picks what to show instead.
   */
  label?: string
  /** Remote address of the socket, for telling same-named devices apart. */
  address?: string
  /** Epoch milliseconds, for "connected 3 minutes ago". */
  connectedAt: number
  /** This host's own window rather than a guest. */
  self: boolean
}

/**
 * The connected-device list, or the reason there is none.
 *
 * A union rather than a bare array. An empty array means the host read its
 * registry and nobody is connected. A failure means it could not read it. Both
 * show as a blank panel, so callers must tell them apart.
 */
export type GetConnectedDevicesResponse =
  | {
      success: false
      error: Error
    }
  | {
      success: true
      data: { connections: SyncConnection[] }
    }

export class GetConnectedDevicesError extends Error {
  constructor() {
    super('Could not get connected devices')
  }
}

/**
 * The payload of a connected-devices event. It carries the whole new list
 * rather than a delta, so a renderer that misses one recovers on the next.
 */
export type ConnectedDevicesEvent = { connections: SyncConnection[] }
