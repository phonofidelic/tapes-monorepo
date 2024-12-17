import { useEffect } from 'react'
import { isValidAutomergeUrl } from '@automerge/automerge-repo/slim'
import { useRepo } from '@automerge/automerge-repo-react-hooks'
import { QRCodeSVG } from 'qrcode.react'
import { useSettings } from '@/context/SettingsContext'
import { AudioInputSelector } from '@/AudioInputSelector'
import { useAppContext } from '@/context/AppContext'

export function Settings() {
  const appContext = useAppContext()
  const { settingsDocUrl, setSettingsDocUrl } = useSettings()
  const repo = useRepo()
  const baseUrl =
    process.env.NODE_ENV === 'production'
      ? 'https://tapes-monorepo-web.vercel.app'
      : `${import.meta.env.VITE_LOCAL_NETWORK_PROTOCOL}://${import.meta.env.VITE_LOCAL_NETWORK_IP}:3000`

  useEffect(() => {
    if (isValidAutomergeUrl(settingsDocUrl)) {
      const handle = repo.find(settingsDocUrl)
      setSettingsDocUrl(handle.url)
    } else {
      const handle = repo.create<{
        audioInputDeviceId?: string
        audioFormat?: 'mp3' | 'wav' | 'ogg' | 'flac'
        storageLocation?: string
      }>({})
      setSettingsDocUrl(handle.url)
    }
  }, [settingsDocUrl])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2>Audio</h2>
        <label className="flex flex-col gap-2 text-sm">
          <h3>Input device:</h3>
          <AudioInputSelector className="p-2" />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <h3>Format:</h3>
          <select className="flex appearance-none items-center justify-center rounded bg-transparent p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <option value="">Select a recording format</option>
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
            <option value="ogg">OGG</option>
            <option value="flac">FLAC</option>
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <h2>Storage</h2>
        <label className="flex flex-col gap-2 text-sm">
          <h3>Location:</h3>
          {appContext === 'electron-client' ? (
            <select className="flex appearance-none items-center justify-center rounded bg-transparent p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <option value="">Select a storage location</option>
              <option value="desktop">Desktop</option>
              <option value="documents">Documents</option>
              <option value="downloads">Downloads</option>
            </select>
          ) : (
            <p>Not implemented yet</p>
          )}
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <h2>Data</h2>
        <p className="text-sm">Replicate your data to another device:</p>
        <div>
          <QRCodeSVG value={`${baseUrl}/app/?am=${settingsDocUrl}`} />
        </div>
      </div>
    </div>
  )
}
