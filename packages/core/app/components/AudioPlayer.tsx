import { useAudioPlayer } from '@/context/AudioPlayerContext'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { clsx } from 'clsx'
import { MdStop, MdPlayArrow, MdPause } from 'react-icons/md'
import { Button } from '@tapes-monorepo/ui'
import { RecordingData } from '@/types'

export function AudioPlayer({}: {}) {
  const { currentUrl, setCurrentUrl, isPlaying, setIsPlaying } =
    useAudioPlayer()
  const [recording] = useDocument<RecordingData>(currentUrl)

  return (
    <div
      className={clsx(
        'fixed bottom-0 left-0 flex h-20 w-full items-center justify-between border border-zinc-100 bg-white transition-transform dark:border-zinc-800 dark:bg-zinc-900',
        {
          'translate-y-full': !currentUrl,
          'translate-y-0 drop-shadow-2xl': currentUrl,
        },
      )}
    >
      <div className="size-20 border"></div>
      <div className="">
        <p>{recording?.name}</p>
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
          }}
        >
          <MdStop />
        </Button>
      </div>
    </div>
  )
}
