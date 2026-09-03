import { useState } from 'react'
import {
  useAudioPlayer,
  type PlaybackFailure,
} from '@/context/AudioPlayerContext'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { clsx } from 'clsx'
import { MdStop, MdPlayArrow, MdPause } from 'react-icons/md'
import { Button } from '@tapes-monorepo/ui'
import { RecordingData } from '@/types'
import { FormattedTime, formatTime } from './FormattedTime'

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

/** How far an arrow key moves the transport, in seconds. */
const KEYBOARD_STEP = 5

export function AudioPlayer() {
  const {
    currentUrl,
    setCurrentUrl,
    setCurrentSource,
    isPlaying,
    setIsPlaying,
    duration,
    seekableDuration,
    currentTime,
    seek,
    playbackState,
    playbackFailure,
  } = useAudioPlayer()
  const [recording] = useDocument<RecordingData>(currentUrl)
  // Where the pointer is during a drag. The transport follows this rather than
  // the element, so the bar and the elapsed readout keep up with the hand even
  // though the audio only moves on release.
  const [dragTime, setDragTime] = useState<number | null>(null)

  // Nothing is addressable while the audio is still being fetched, after it
  // failed, or while the element reports a length we can't take a fraction of
  // (`Infinity` for a MediaRecorder-written mp4 that hasn't been played
  // through).
  const canSeek =
    playbackState !== 'loading' &&
    playbackState !== 'error' &&
    seekableDuration > 0

  const displayTime = dragTime ?? currentTime
  const progress = seekableDuration > 0 ? displayTime / seekableDuration : 0

  const timeFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect()
    if (width <= 0) {
      return 0
    }
    const ratio = Math.min(Math.max((event.clientX - left) / width, 0), 1)
    return ratio * seekableDuration
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canSeek) {
      return
    }
    const time = timeFromPointer(event)
    // Pointer capture so a drag that wanders off a 12px-tall strip — which is
    // most of them — still tracks.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragTime(time)
    seek(time)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragTime === null) {
      return
    }
    setDragTime(timeFromPointer(event))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragTime === null) {
      return
    }
    seek(timeFromPointer(event))
    setDragTime(null)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canSeek) {
      return
    }
    const target = {
      ArrowLeft: currentTime - KEYBOARD_STEP,
      ArrowDown: currentTime - KEYBOARD_STEP,
      ArrowRight: currentTime + KEYBOARD_STEP,
      ArrowUp: currentTime + KEYBOARD_STEP,
      Home: 0,
      End: seekableDuration,
    }[event.key]
    if (target === undefined) {
      return
    }
    // Arrows and Home/End would otherwise scroll the library behind the player.
    event.preventDefault()
    seek(target)
  }

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
        {/* The track stays a hairline, but a hairline is not a pointer target,
            so the interactive strip is 12px tall with the track centred in it. */}
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={seekableDuration}
          aria-valuenow={canSeek ? displayTime : undefined}
          aria-valuetext={
            canSeek ? formatTime(displayTime * 1000) : 'Unavailable'
          }
          aria-disabled={!canSeek}
          tabIndex={canSeek ? 0 : -1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className={clsx(
            'absolute top-0 left-0 flex h-3 w-full touch-none items-center outline-none',
            'focus-visible:ring-2 focus-visible:ring-rose-500/50',
            canSeek ? 'cursor-pointer' : 'cursor-default',
          )}
        >
          <div className="h-1 w-full bg-transparent">
            <div
              className={clsx(
                'h-full',
                canSeek ? 'bg-rose-500' : 'bg-zinc-300 dark:bg-zinc-700',
              )}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
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
              <FormattedTime time={displayTime * 1000} />
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
