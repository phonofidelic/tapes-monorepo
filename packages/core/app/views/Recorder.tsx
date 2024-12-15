import { Button } from '@tapes-monorepo/ui'
import { AudioInputSelector } from '@/AudioInputSelector'
import { useSettings } from '@/context/SettingsContext'

export function Recorder() {
  const { audioInputDeviceId } = useSettings()

  return (
    <>
      <div className="flex h-full flex-col pb-20">
        <h1 className="">Recorder</h1>
      </div>
      <div className="fixed bottom-0 left-0 z-10 flex h-20 w-full items-center justify-center border-t border-zinc-100 dark:border-zinc-800">
        {audioInputDeviceId ? (
          <Button
            className="size-full p-4"
            onClick={() => console.log('monitor')}
            disabled={!audioInputDeviceId}
          >
            Monitor
          </Button>
        ) : (
          <AudioInputSelector className="size-full p-6" />
        )}
      </div>
    </>
  )
}