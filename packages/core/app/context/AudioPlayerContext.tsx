import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { AutomergeUrl } from '@automerge/automerge-repo'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { RecordingData } from '@/types'
import {
  BlobFetchError,
  fetchBlobFromAny,
  replicateBlob,
  type BlobFailureReason,
} from '@/blobClient'
import { cacheBlob, cachedBlobSource, recordCacheHit } from '@/blobCache'
import { useAppContext } from './AppContext'
import { useBlobEndpoints } from './BlobContext'

/**
 * `loading` covers fetching a recording's audio from the host on first play,
 * which can take a moment for a long tape; `error` means it could not be
 * resolved at all, which previously just cleared the player with no
 * explanation.
 */
export type PlaybackState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Which failure `error` was.
 *
 * Every way playback can fail used to arrive at the player as the same
 * "not available offline", which is only true for one of them: a host that
 * rejected our token, one that never received the audio, and one that is
 * genuinely switched off each need a different thing from the user. Carried
 * alongside `playbackState` rather than folded into it so the state machine
 * itself stays a plain four-value union.
 */
export type PlaybackFailure =
  | BlobFailureReason
  /** The recording's bytes never reached a host, so there is nobody to ask. */
  | 'not-uploaded'

/**
 * One play of one recording, as measured by the transport.
 *
 * Shaped to the host's `PlaybackEvent`: the queue that carries these to the
 * host mints the event id and stamps the device, so the measurement itself
 * reports only what it can actually observe.
 */
export type PlaySession = {
  /** Automerge url of the recording that was played. */
  recordingUrl: AutomergeUrl
  /**
   * The furthest point reached in this session, as a fraction of the
   * recording's length, clamped to `[0, 1]`. The high-water mark of
   * `currentTime` and not accumulated listening time: seeking back and playing
   * a passage twice must not push a play past 100%.
   */
  completion: number
  /** When the session started, on this device's clock. */
  occurredAt: string
}

/**
 * Below this much actual playback a session is a scrub, a mis-tap or a
 * preview, and counting it would inflate the play count for exactly the
 * recordings nobody listened to.
 */
const MIN_PLAY_SECONDS = 5

/**
 * The largest forward step in `currentTime` that can be playback rather than a
 * seek. Seeks reset the baseline where we can see them, so this only catches
 * the ones we can't — a media-key scrub, or an element that moved without
 * saying so. Generous enough to survive a throttled background tab, which
 * fires `timeupdate` about once a second.
 */
const MAX_PLAYBACK_STEP = 2

/** The in-flight session, kept in refs so measuring never re-renders. */
type OpenSession = {
  recordingUrl: AutomergeUrl
  startedAt: number
  /** Seconds of actual playback, seeks excluded. */
  played: number
  /** Furthest `currentTime` reached. */
  maxTime: number
}

type AudioPlayerContextValue = {
  audioRef: React.RefObject<HTMLAudioElement>
  currentTime: number
  duration: number
  /**
   * The length the transport can actually address. Normally `duration`, but a
   * media element commonly reports `Infinity` for a MediaRecorder-written
   * `audio/mp4` until it has seen the whole stream, and a fraction of that is
   * meaningless — so fall back to how far the element says it can seek, and to
   * `0` when it can't seek at all.
   */
  seekableDuration: number
  currentSource: string | undefined
  setCurrentSource: React.Dispatch<React.SetStateAction<string | undefined>>
  currentUrl: AutomergeUrl | undefined
  setCurrentUrl: React.Dispatch<React.SetStateAction<AutomergeUrl | undefined>>
  isPlaying: boolean
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>
  /**
   * Moves both the audio element and the transport to `time` (seconds),
   * clamped to what is seekable. A no-op while nothing is addressable.
   */
  seek: (time: number) => void
  playbackState: PlaybackState
  /** Only meaningful while `playbackState` is `'error'`. */
  playbackFailure: PlaybackFailure | undefined
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | undefined>(
  undefined,
)

/**
 * Whether a recording's `filepath` could name a file in this device's OPFS,
 * which holds recordings flat under a uuid. Anything with a path separator (or
 * a relative-path segment) came from an electron host's real filesystem.
 */
const isOpfsName = (filepath: string): boolean =>
  filepath.length > 0 &&
  !filepath.includes('/') &&
  !filepath.includes('\\') &&
  filepath !== '.' &&
  filepath !== '..'

export const AudioPlayerProvider = ({
  children,
  onPlaySession,
}: {
  children: React.ReactNode
  /**
   * Called once per play session that cleared `MIN_PLAY_SECONDS`, when the
   * session closes. Optional: nothing about playback depends on anyone
   * listening, so a host that does not count plays simply omits it.
   */
  onPlaySession?: (session: PlaySession) => void
}) => {
  const appContext = useAppContext()
  const blobEndpoints = useBlobEndpoints()
  const audioRef = useRef<HTMLAudioElement>(new Audio())
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle')
  const [playbackFailure, setPlaybackFailure] = useState<
    PlaybackFailure | undefined
  >(undefined)
  const [currentSource, setCurrentSource] = useState<string | undefined>(
    undefined,
  )
  const [currentUrl, setCurrentUrl] = useState<AutomergeUrl | undefined>(
    undefined,
  )
  // The recording doc for whatever is loaded in the player. When it carries
  // embedded `audio` bytes (synced from another device) we play those directly,
  // so a guest can play a recording it never made.
  const [recordingDoc] = useDocument<RecordingData>(currentUrl)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Mirrors `duration` so `onEnded` can read the latest value without the
  // audio effect re-running (and calling audio.load()) whenever it changes.
  const durationRef = useRef(0)
  const [isPlaying, setIsPlaying] = useState(false)
  // How far the element reports it can seek, for the sources whose `duration`
  // never resolves to a finite number.
  const [seekableEnd, setSeekableEnd] = useState(0)
  // Declared up here because the play-session helpers below read the length
  // through it; kept in step with `seekableDuration` further down.
  const seekableDurationRef = useRef(0)
  const sessionRef = useRef<OpenSession | null>(null)
  // Where `currentTime` was when we last looked, so playback can be told from
  // a jump.
  const lastTimeRef = useRef(0)
  const onPlaySessionRef = useRef(onPlaySession)
  useEffect(() => {
    onPlaySessionRef.current = onPlaySession
  }, [onPlaySession])

  useEffect(() => {
    // Detach whatever the player is holding before resolving anything.
    // Resolving is asynchronous and can fail outright, and until this ran the
    // element kept the previous recording's `src`: play an unavailable tape
    // and the last one played instead, under the new recording's name.
    const audio = audioRef.current
    audio.pause()
    audio.removeAttribute('src')
    audio.load()

    if (!currentUrl) {
      return
    }

    // Wait for the recording doc to resolve before choosing a source. Until it
    // loads we can't tell where the audio is, and falling back to storage:get
    // here throws NotFoundError for a recording synced from another device
    // (whose bytes were never in this device's OPFS).
    if (!recordingDoc) {
      return
    }

    let cancelled = false
    let objectUrl: string | undefined
    // Switching recordings has to stop the transfer, not just discard what
    // comes back: a guest on a slow LAN would otherwise go on pulling a tape
    // nobody is listening to any more, delaying the one that is playing.
    const controller = new AbortController()

    const play = (src: string, revoke = false) => {
      if (cancelled) {
        if (revoke) {
          URL.revokeObjectURL(src)
        }
        return
      }
      if (revoke) {
        objectUrl = src
      }
      if (audioRef.current) {
        audioRef.current.src = src
      }
      setPlaybackState('ready')
    }

    const resolve = async () => {
      setPlaybackState('loading')
      setPlaybackFailure(undefined)
      // The transport belongs to whatever is being loaded now, not to the
      // recording that was just detached.
      setCurrentTime(0)
      setDuration(0)
      durationRef.current = 0
      setSeekableEnd(0)

      // 1. Legacy embedded bytes. Automerge history is append-only, so docs
      //    written before audio moved out of band still carry their audio and
      //    always will. They have no hash, so this never competes with the
      //    paths below.
      const embeddedAudio = recordingDoc.audio
      if (embeddedAudio) {
        play(
          URL.createObjectURL(
            // Automerge types the bytes as Uint8Array<ArrayBufferLike>, but
            // BlobPart wants Uint8Array<ArrayBuffer>; identical at runtime.
            new Blob([embeddedAudio as BlobPart], {
              type: recordingDoc.mimeType ?? 'audio/mp4',
            }),
          ),
          true,
        )
        return
      }

      const descriptor = recordingDoc.blob

      // 2. Already cached locally, from an earlier play or an explicit pin.
      //    This is the path that works with the host switched off.
      if (descriptor) {
        const cached = await cachedBlobSource(appContext, descriptor)
        if (cached) {
          play(cached.src, cached.revoke)
          return
        }
      }

      // 3. This device's own copy of a recording it made itself. Also covers
      //    a recording whose upload has not landed yet.
      const local = await localSource()
      if (local) {
        play(local.src, local.revoke)
        return
      }

      // 4. Fetch from whichever host has it and keep what comes back, so a
      //    guest's storage grows with what it has played rather than with the
      //    whole library. More than one host is in play when this device syncs
      //    with a remote server as well as its own embedded one: the doc can
      //    carry a hash the nearest store has never seen.
      // Nothing local answered. What the user should be told from here on
      // depends on why, so carry the reason rather than deciding at the end
      // that everything was "offline".
      let failure: PlaybackFailure = descriptor ? 'unpaired' : 'not-uploaded'

      if (descriptor && blobEndpoints.length > 0) {
        try {
          const { blob, missingFrom } = await fetchBlobFromAny(
            blobEndpoints,
            descriptor.hash,
            { signal: controller.signal },
          )
          if (cancelled) {
            return
          }
          play(URL.createObjectURL(blob), true)
          // Now that the bytes are here, hand them to the hosts that did not
          // have them, so the next device to ask does not depend on which one
          // happens to be awake. Ahead of the local cache write, which is a
          // separate promise that can fail on its own.
          if (missingFrom.length > 0) {
            void replicateBlob(missingFrom, blob, {
              mimeType: descriptor.mimeType,
              docUrl: recordingDoc.url,
              expectedHash: descriptor.hash,
            })
          }
          await cacheBlob(appContext, descriptor, blob, recordingDoc.url)
          recordCacheHit(descriptor.hash, descriptor.size, localStorage)
          return
        } catch (error) {
          // We withdrew the question ourselves; the cleanup already handled it.
          if (controller.signal.aborted) {
            return
          }
          failure =
            error instanceof BlobFetchError ? error.reason : 'unreachable'
          console.error('Could not fetch recording audio:', error)
        }
      }

      if (!cancelled) {
        setPlaybackFailure(failure)
        setPlaybackState('error')
        // There is nothing loaded to play, so leaving the transport running
        // would show a pause button over silence.
        setIsPlaying(false)
      }
    }

    /**
     * The bytes as this device stored them at record time: an OPFS file on
     * web, the user's own audio file on electron.
     */
    const localSource = async (): Promise<{
      src: string
      revoke: boolean
    } | null> => {
      if (!currentSource) {
        return null
      }
      if (appContext.type === 'electron-client') {
        // The protocol handler resolves a path this device knows about; a
        // recording made elsewhere has a filepath that means nothing here.
        return recordingDoc.filepath
          ? { src: `tapes://${currentSource}`, revoke: false }
          : null
      }
      // OPFS names are flat. A recording made on an electron host carries an
      // absolute filesystem path, which `getFileHandle` rejects outright with
      // a TypeError ("Name is not allowed") rather than reporting a miss.
      // Asking for it is meaningless here anyway — those bytes were never in
      // this device's OPFS, and the host is asked for them below.
      if (!isOpfsName(currentSource)) {
        return null
      }
      return new Promise((resolveSource) => {
        const worker = appContext.worker
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== 'storage:get:response') {
            return
          }
          worker.removeEventListener('message', onMessage)
          if (!event.data.success) {
            resolveSource(null)
            return
          }
          const { url } = event.data.payload as { url: string }
          resolveSource({ src: url, revoke: false })
        }
        worker.addEventListener('message', onMessage)
        worker.postMessage({
          type: 'storage:get',
          payload: { filename: currentSource },
        })
      })
    }

    void resolve()

    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [
    currentUrl,
    currentSource,
    appContext,
    blobEndpoints,
    recordingDoc,
    recordingDoc?.audio,
    recordingDoc?.blob,
  ])

  /**
   * Fold the transport's new position into the open session: how much of the
   * step was playback, and whether it is the furthest we have been.
   */
  const trackPlayback = useCallback((time: number) => {
    const session = sessionRef.current
    if (!session || !Number.isFinite(time)) {
      return
    }
    const step = time - lastTimeRef.current
    lastTimeRef.current = time
    if (step > 0 && step <= MAX_PLAYBACK_STEP) {
      session.played += step
    }
    if (time > session.maxTime) {
      session.maxTime = time
    }
  }, [])

  /** Baseline the next step against `time` without counting the gap. */
  const rebaseline = useCallback((time: number) => {
    if (Number.isFinite(time)) {
      lastTimeRef.current = time
    }
  }, [])

  const closePlaySession = useCallback((session: OpenSession) => {
    if (session.played < MIN_PLAY_SECONDS) {
      return
    }
    const length = seekableDurationRef.current
    // A fraction of a length nothing can address is meaningless — that is the
    // `Infinity` duration case — and a made-up percentage is worse than a
    // missing play, so drop the session rather than guess.
    if (!Number.isFinite(length) || length <= 0) {
      return
    }
    onPlaySessionRef.current?.({
      recordingUrl: session.recordingUrl,
      completion: Math.min(Math.max(session.maxTime / length, 0), 1),
      occurredAt: new Date(session.startedAt).toISOString(),
    })
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    audio.load()

    const readSeekableEnd = () => {
      // jsdom — and a source that has buffered nothing — has no seekable range.
      const seekable = audio.seekable
      if (!seekable || seekable.length === 0) {
        return
      }
      setSeekableEnd(seekable.end(seekable.length - 1))
    }

    const onLoadedMetadata = () => {
      durationRef.current = audio.duration
      setDuration(audio.duration)
      readSeekableEnd()
    }

    // `duration` arrives as Infinity for a MediaRecorder-written stream and is
    // corrected once the element has seen the end of it.
    const onDurationChange = () => {
      durationRef.current = audio.duration
      setDuration(audio.duration)
      readSeekableEnd()
    }

    const onCanPlay = async () => {
      if (isPlaying) {
        await audio.play()
      }
    }

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      trackPlayback(audio.currentTime)
      readSeekableEnd()
    }

    // A seek is not listening. The element also fires `timeupdate` for one, so
    // the baseline has to move before that arrives.
    const onSeeking = () => {
      rebaseline(audio.currentTime)
    }

    const onProgress = () => {
      readSeekableEnd()
    }

    const onEnded = () => {
      audio.pause()
      setIsPlaying(false)
      // Park the element and the transport in the same place. This used to
      // report 0 while leaving the element at the end, so a seek after a
      // natural end started from somewhere the UI never showed.
      const end = Number.isFinite(durationRef.current)
        ? durationRef.current
        : audio.currentTime
      audio.currentTime = end
      setCurrentTime(end)
      // Playing a tape out is the one way to genuinely reach the end, and the
      // last `timeupdate` always lands short of it.
      trackPlayback(end)
    }

    const onError = () => {
      console.error('Audio error:', audio.error)
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('seeking', onSeeking)
    audio.addEventListener('progress', onProgress)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('seeking', onSeeking)
      audio.removeEventListener('progress', onProgress)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [isPlaying, trackPlayback, rebaseline])

  /**
   * A session runs for as long as one recording is playing. Closing it from
   * the cleanup covers every way it can end with one path: a pause or a
   * natural end (both of which clear `isPlaying`), a change of recording, and
   * the provider unmounting — which is how most plays end, the user navigating
   * away mid-tape.
   */
  useEffect(() => {
    if (!isPlaying || !currentUrl) {
      return
    }
    const session: OpenSession = {
      recordingUrl: currentUrl,
      startedAt: Date.now(),
      played: 0,
      maxTime: audioRef.current.currentTime,
    }
    sessionRef.current = session
    lastTimeRef.current = audioRef.current.currentTime

    return () => {
      sessionRef.current = null
      closePlaySession(session)
    }
  }, [isPlaying, currentUrl, closePlaySession])

  const seekableDuration =
    Number.isFinite(duration) && duration > 0 ? duration : seekableEnd
  // `seek` is handed to pointer and key handlers that re-bind on every move,
  // so keep it stable and read the bound through a ref rather than a dep.
  useEffect(() => {
    seekableDurationRef.current = seekableDuration
  }, [seekableDuration])

  const seek = useCallback(
    (time: number) => {
      const limit = seekableDurationRef.current
      if (!Number.isFinite(time) || limit <= 0) {
        return
      }
      const next = Math.min(Math.max(time, 0), limit)
      audioRef.current.currentTime = next
      // The element emits `timeupdate` at its own cadence, so move the transport
      // now rather than a frame or two later.
      setCurrentTime(next)
      // jsdom, and any element that seeks without announcing it, never fires
      // `seeking`; without this the jump would be counted as listening.
      rebaseline(next)
    },
    [rebaseline],
  )

  return (
    <AudioPlayerContext.Provider
      value={{
        audioRef,
        currentTime,
        duration,
        currentSource,
        setCurrentSource,
        currentUrl,
        setCurrentUrl,
        isPlaying,
        setIsPlaying,
        seekableDuration,
        seek,
        playbackState,
        playbackFailure,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  )
}

export const useAudioPlayer = (): AudioPlayerContextValue => {
  const context = useContext(AudioPlayerContext)

  if (context === undefined) {
    throw new Error('useAudioPlayer must be used within an AudioPlayerProvider')
  }
  return context
}
