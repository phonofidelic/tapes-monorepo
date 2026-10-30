/**
 * How a host turns away a device whose key it knows to be revoked.
 *
 * The refusal cannot be an HTTP status. A browser reports a failed upgrade as
 * a bare error with no status and no reason, which looks the same as a broken
 * network. So the host completes the handshake and closes the socket at once
 * with the code below, which the guest can read and report.
 */

/** In the 4000-4999 range the WebSocket spec leaves to applications. */
export const SYNC_CLOSE_REVOKED = 4001

/** Sent with the code. Short, because a close reason is capped at 123 bytes. */
export const SYNC_CLOSE_REVOKED_REASON = 'device-key-revoked'
