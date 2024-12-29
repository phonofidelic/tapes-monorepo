import { useAudioPlayer } from '@/context/AudioPlayerContext'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { clsx } from 'clsx'
import { MdStop, MdPlayArrow, MdPause } from 'react-icons/md'
import { Button } from '@tapes-monorepo/ui'
import { RecordingData } from '@/types'
import { FormattedTime } from './FormattedTime'

export function AudioPlayer({}: {}) {
  const {
    currentUrl,
    setCurrentUrl,
    setCurrentSource,
    isPlaying,
    setIsPlaying,
    duration,
    currentTime,
  } = useAudioPlayer()
  const [recording] = useDocument<RecordingData>(currentUrl)

  const progress = (currentTime * 1000) / duration
  // console.log('*** progress:', progress)

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
      <div className="relative">
        <div className="absolute left-0 top-0 w-full">
          <div
            key={currentTime}
            className="h-1 bg-rose-500"
            style={{
              width: `${progress * 100}%`,
            }}
          />
        </div>
      </div>
      <div className="flex h-20 w-full items-center justify-between">
        {/* <div className="flex size-20 border"></div> */}
        <div className="w-full p-4">
          <p>{recording?.name}</p>
          <div className="flex w-full justify-between gap-2">
            <p className="text-sm">
              <FormattedTime time={currentTime * 1000} />
            </p>
            <p className="text-sm">
              <FormattedTime time={duration} />
            </p>
          </div>
        </div>
        <div className="flex gap-2 p-4">
          <Button
            className="rounded-full p-2"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <MdPause /> : <MdPlayArrow />}
          </Button>
          <Button
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
