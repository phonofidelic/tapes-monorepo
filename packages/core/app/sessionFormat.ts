/**
 * How the session strip writes a session's ID and its times.
 */

/** The first eight hex characters of the ID, as two groups: `7c41·e2b0`. */
export function shortSessionId(sessionId: string): string {
  const hex = sessionId.replace(/[^0-9a-f]/gi, '').toLowerCase()
  // An ID that is not a UUID still needs a stable, short label.
  const short = hex.length >= 8 ? hex.slice(0, 8) : sessionId.slice(0, 8)
  return short.length > 4 ? `${short.slice(0, 4)}·${short.slice(4)}` : short
}

/** `m:ss` under an hour, then `h:mm:ss`. Negative spans read as zero. */
export function formatSessionClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  if (hours === 0) {
    return `${minutes}:${seconds}`
  }
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
}

/** Wall-clock `HH:mm` in the device's time zone. */
export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
