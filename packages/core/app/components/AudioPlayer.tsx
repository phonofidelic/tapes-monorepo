import {
  useAudioPlayer,
  type PlaybackFailure,
} from '@/context/AudioPlayerContext'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { clsx } from 'clsx'
import { MdStop, MdPlayArrow, MdPause } from 'react-icons/md'
import { Button } from '@tapes-monorepo/ui'
import { RecordingData } from '@/types'
import { FormattedTime } from './FormattedTime'

/**
 * What each failure asks of the user. Only `unreachable` is the "offline" case
 * this line used to claim for all of them — a host that rejected our token is
 * sitting right there, and a recording that never reached one will not appear
 * however long the user waits.
 */
const FAILURE_MESSAGE: Record<PlaybackFailure, string> = {
  unreachable: 'Host unreachable — not available offline',
  unauthorized: "Pairing expired — re-scan the host's code",
  'not-uploaded': 'Still uploading from the host',
  missing: "The host doesn't have this recording",
  unpaired: 'Not paired with a host',
}

export function AudioPlayer() {
  const {
    currentUrl,
    setCurrentUrl,
    setCurrentSource,
    isPlaying,
    setIsPlaying,
    duration,
    currentTime,
    playbackState,
    playbackFailure,
  } = useAudioPlayer()
  const [recording] = useDocument<RecordingData>(currentUrl)

  const progress = currentTime / duration

  return (
    <div
      className={clsx(
        'fixed bottom-0 left-0 w-full border border-zinc-100 bg-white transition-transform dark:border-zinc-800 dark:bg-zinc-900',
        {
          'translate-y-full': !currentUrl,
          'translate-y-0 drop-shadow-2xl': currentUrl,
        },
      )}
    >
      {/* The bar is full-bleed so its background and border span the window;
          the progress track and the controls below follow `main`'s column. */}
      <div className="relative mx-auto max-w-3xl">
        <div className="absolute top-0 left-0 w-full">
          <div
            key={currentTime}
            className="h-1 bg-rose-500"
            style={{
              width: `${progress * 100}%`,
            }}
          />
        </div>
      </div>
      <div className="mx-auto flex h-20 w-full max-w-3xl items-center justify-between">
        <div className="w-full p-4">
          <p>{recording?.name}</p>
          {/* Fetching a recording from the host is the one moment playback is
              not instant, and a failure used to clear the player silently. */}
          {playbackState === 'loading' && (
            <p className="text-xs text-zinc-400">Downloading…</p>
          )}
          {playbackState === 'error' && (
            <p className="text-xs text-rose-500">
              {FAILURE_MESSAGE[playbackFailure ?? 'unreachable']}
            </p>
          )}
          <div className="flex w-full justify-between gap-2">
            <p className="text-sm">
              <FormattedTime time={currentTime * 1000} />
            </p>
            <p className="text-sm">
              {isFinite(duration) && <FormattedTime time={duration * 1000} />}
            </p>
          </div>
        </div>
        <div className="flex gap-2 p-4">
          <Button
            title={isPlaying ? 'Pause' : 'Play'}
            className="rounded-full p-2"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <MdPause /> : <MdPlayArrow />}
          </Button>
          <Button
            title="Stop"
            className="rounded-full p-2"
            onClick={() => {
              setIsPlaying(false)
              setCurrentUrl(undefined)
              setCurrentSource(undefined)
            }}
          >
            <MdStop />
          </Button>
        </div>
      </div>
    </div>
  )
}
