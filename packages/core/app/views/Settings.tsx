import { MdOutlineRemoveCircleOutline } from 'react-icons/md'
import { useSetting } from '@/context/SettingsContext'
import { AudioInputSelector } from '@/components/AudioInputSelector'
import { useAppContext } from '@/context/AppContext'
import { Button } from '@tapes-monorepo/ui'
import { SyncSettings } from '@/components/SyncSettings'

export function Settings() {
  const appContext = useAppContext()
  const [audioFormat, setAudioFormat] = useSetting('audioFormat')
  const [audioChannelCount, setAudioChannelCount] =
    useSetting('audioChannelCount')
  const [storageLocation, setStorageLocation] = useSetting('storageLocation')

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <h2>Audio</h2>
        <label className="flex flex-col gap-2 text-sm">
          <h3>Input device:</h3>
          <AudioInputSelector className="p-2" />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <h3>Recording format:</h3>
          <select
            className="flex appearance-none items-center justify-center rounded-sm bg-transparent p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onChange={(event) => {
              setAudioFormat(
                event.target.value as 'mp3' | 'wav' | 'ogg' | 'flac',
              )
            }}
            defaultValue={audioFormat ?? ''}
          >
            <option value="flac">FLAC</option>
            <option value="mp3">MP3</option>
            <option value="ogg">OGG</option>
            <option value="wav">WAV</option>
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <h3>Channels:</h3>
          <select
            className="flex appearance-none items-center justify-center rounded-sm bg-transparent p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onChange={(event) => {
              setAudioChannelCount(event.target.value as '1' | '2')
            }}
            defaultValue={audioChannelCount || '1'}
          >
            <option value="1">{'Mono (1)'}</option>
            <option value="2">{'Stereo (2)'}</option>
          </select>
        </label>
      </div>
      {appContext.type === 'electron-client' && (
        <div className="flex flex-col gap-2">
          <h2>Storage</h2>
          <div className="flex flex-col gap-1 text-sm">
            {storageLocation && (
              <p className="truncate pl-2 text-xs" title={storageLocation}>
                {storageLocation}
              </p>
            )}
            <div className="flex gap-1">
              <Button
                className="w-fit p-2"
                id="storage-selector"
                onClick={async () => {
                  const response = (await appContext.ipc.send(
                    'storage:open-directory-dialog',
                  )) as string | undefined

                  if (!response) {
                    console.error(
                      'No response from storage:open-directory-dialog',
                    )
                    return
                  }

                  if (response === '__unset__') {
                    return
                  }

                  setStorageLocation(response)
                }}
              >
                {storageLocation
                  ? 'Change storage location'
                  : 'Select a storage location'}
              </Button>
              {storageLocation && (
                <Button
                  className="w-fit rounded-full p-2 text-lg"
                  title="Remove storage location"
                  onClick={() => {
                    setStorageLocation(undefined)
                  }}
                >
                  <MdOutlineRemoveCircleOutline />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      <SyncSettings />
    </div>
  )
}
