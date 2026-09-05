import {
  useRecordingPlayback,
  type RecordingPlayback,
} from '@/context/AggregatesContext'

/**
 * Renders one recording's play count and average completion.
 *
 * The counts are anonymous aggregates, so the copy counts plays and never
 * people. A recording with no answer from its host must not read as zero, so
 * the three playback states each get their own wording.
 */

/**
 * Rounds a 0..1 completion to whole percent.
 *
 * A play that barely started still happened. Rounding it to `0%` next to a
 * count that says somebody listened would be wrong, so it becomes `<1%`.
 */
export function formatCompletion(averageCompletion: number): string {
  const percent = Math.round(averageCompletion * 100)
  if (percent === 0 && averageCompletion > 0) {
    return '<1%'
  }
  return `${percent}%`
}

/** The line of text for a playback state, and the tooltip that explains it. */
export function playbackSummary(playback: RecordingPlayback): {
  text: string
  title: string
} {
  switch (playback.status) {
    case 'unknown':
      return {
        text: 'Plays unknown',
        title: 'The host that counts plays for this library has not answered',
      }
    case 'unplayed':
      return {
        text: '0 plays',
        title: 'This host has counted no plays of this recording',
      }
    case 'played': {
      const completion = formatCompletion(playback.averageCompletion)
      // One play is not an average. The number is the same, but the word
      // would suggest a spread that a single measurement does not have.
      return playback.plays === 1
        ? {
            text: `1 play · ${completion} complete`,
            title: 'One play, counted by the host of this library',
          }
        : {
            text: `${playback.plays} plays · ${completion} complete on average`,
            title:
              'Plays counted by the host of this library. Plays are counted anonymously, so this is not a number of listeners.',
          }
    }
  }
}

export function PlaybackSummary({
  recordingUrl,
}: {
  recordingUrl: string | undefined
}) {
  const playback = useRecordingPlayback(recordingUrl)
  const { text, title } = playbackSummary(playback)

  // Same size and colour as the duration next to it. These numbers are a
  // detail on a recording, not a report.
  return (
    <span
      title={title}
      className={playback.status === 'unknown' ? 'italic' : undefined}
    >
      {text}
    </span>
  )
}
