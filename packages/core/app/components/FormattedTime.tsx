/** `hh:mm:ss` for a duration in milliseconds. */
export function formatTime(time: number): string {
  // Non-finite or negative input would otherwise render as `aN:aN:aN`.
  const ms = Number.isFinite(time) && time > 0 ? time : 0

  const seconds = ('0' + (Math.floor(ms / 1000) % 60)).slice(-2)
  const minutes = ('0' + (Math.floor(ms / 60000) % 60)).slice(-2)
  const hours = ('0' + Math.floor(ms / 3600000)).slice(-2)

  return `${hours}:${minutes}:${seconds}`
}

export function FormattedTime({ time }: { time: number }) {
  return formatTime(time)
}
