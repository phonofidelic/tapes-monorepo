import { useEffect, useState } from 'react'
import {
  MdOutlineContentCopy,
  MdOutlineFileUpload,
  MdOutlineRemoveCircleOutline,
} from 'react-icons/md'
import { QRCodeSVG } from 'qrcode.react'
import { useSetting } from '@/context/SettingsContext'
import { AudioInputSelector } from '@/components/AudioInputSelector'
import { useAppContext } from '@/context/AppContext'
import { Button, TextInput } from '@tapes-monorepo/ui'
import { isValidAutomergeUrl } from '@automerge/automerge-repo'
import { useAutomergeUrl } from '@/utils'
import { SyncServerInfo } from '@/IpcService'

export function Settings() {
  const appContext = useAppContext()
  const [audioFormat, setAudioFormat] = useSetting('audioFormat')
  const [audioChannelCount, setAudioChannelCount] =
    useSetting('audioChannelCount')
  const [storageLocation, setStorageLocation] = useSetting('storageLocation')

  return (
    <div className="flex flex-col gap-4">
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
              setAudioChannelCount(event.target.value)
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
                    setStorageLocation(null)
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

function SyncSettings() {
  const appContext = useAppContext()
  const [syncServerMode, setSyncServerMode] = useSetting('syncServerMode')
  const [remoteSyncServerUrl, setRemoteSyncServerUrl] = useSetting(
    'remoteSyncServerUrl',
  )
  const [syncServerLanEnabled, setSyncServerLanEnabled] = useSetting(
    'syncServerLanEnabled',
  )
  const [syncServerHttpsEnabled, setSyncServerHttpsEnabled] = useSetting(
    'syncServerHttpsEnabled',
  )
  const [pairingToken, setPairingToken] = useSetting('pairingToken')
  const { automergeUrl, setAutomergeUrl } = useAutomergeUrl()
  const [serverInfo, setServerInfo] = useState<SyncServerInfo | null>(null)
  const [remoteUrlDraft, setRemoteUrlDraft] = useState(
    remoteSyncServerUrl ?? '',
  )
  const [tokenDraft, setTokenDraft] = useState(pairingToken ?? '')
  const [importUrl, setImportUrl] = useState('')

  const resolvedSyncServerMode = syncServerMode ?? 'embedded'

  // On the desktop app, guests should load the web-client from this host
  // (same origin as the sync server) rather than the deployed Vercel build,
  // so they don't hit HTTPS-vs-ws mixed-content. Only the LAN-reachable URL
  // works for another device; without it we fall back to the hosted build.
  useEffect(() => {
    if (
      appContext.type !== 'electron-client' ||
      resolvedSyncServerMode !== 'embedded'
    ) {
      return
    }

    // A toggle that lands while this is in flight would otherwise resolve into
    // state describing the server we just moved away from.
    let cancelled = false

    appContext.ipc.send<SyncServerInfo>('sync:get-server-info').then((info) => {
      if (cancelled) {
        return
      }
      setServerInfo(info)
    })

    return () => {
      cancelled = true
    }
  }, [
    appContext,
    resolvedSyncServerMode,
    syncServerLanEnabled, // Re-fetch trigger
    syncServerHttpsEnabled, // Re-fetch trigger
  ])

  // Anyone with this link can read and write the host's recordings: the token
  // in it is what opens both the sync socket and `/blobs`.
  const guestUrl =
    resolvedSyncServerMode === 'embedded' && serverInfo?.lanWebAppUrl
      ? `${serverInfo.lanWebAppUrl}/?am=${automergeUrl}${
          serverInfo.pairingToken
            ? `&pt=${encodeURIComponent(serverInfo.pairingToken)}`
            : ''
        }`
      : null

  return (
    <div className="flex flex-col gap-4">
      <h2>Sync</h2>
      {appContext.type === 'electron-client' && (
        <>
          <label className="flex flex-col gap-2 text-sm">
            <h3>Sync server:</h3>
            <select
              className="flex appearance-none items-center justify-center rounded-sm bg-transparent p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onChange={(event) => {
                // No reload: the shell subscribes to settings changes and rebuilds
                // its repo against the newly resolved servers.
                setSyncServerMode(event.target.value as 'embedded' | 'remote')
              }}
              defaultValue={resolvedSyncServerMode}
            >
              <option value="embedded">This device (built-in)</option>
              <option value="remote">Remote server</option>
            </select>
          </label>

          {resolvedSyncServerMode === 'remote' && (
            <>
              <div className="flex w-full items-center justify-between gap-5 text-sm">
                <TextInput
                  label="Remote sync server URL"
                  type="text"
                  name="remote-sync-server-url"
                  id="remote-sync-server-url"
                  value={remoteUrlDraft}
                  onChange={(event) => setRemoteUrlDraft(event.target.value)}
                  validate={(value) => {
                    try {
                      const url = new URL(value)
                      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
                        return 'Must be a ws:// or wss:// URL'
                      }
                      return undefined
                    } catch {
                      return 'Invalid URL'
                    }
                  }}
                />
                <Button
                  className="w-fit p-2"
                  title="Save sync server URL"
                  onClick={() => {
                    try {
                      const url = new URL(remoteUrlDraft)
                      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
                        return
                      }
                    } catch {
                      return
                    }
                    setRemoteSyncServerUrl(remoteUrlDraft)
                  }}
                >
                  Save
                </Button>
              </div>

              <div className="flex w-full items-center justify-between gap-5 text-sm">
                <TextInput
                  label="Pairing token (optional)"
                  type="text"
                  name="remote-pairing-token"
                  id="remote-pairing-token"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                />
                <Button
                  className="w-fit p-2"
                  title="Save pairing token"
                  onClick={() => {
                    setPairingToken(tokenDraft === '' ? null : tokenDraft)
                  }}
                >
                  Save
                </Button>
              </div>
              <p className="pl-2 text-xs text-zinc-500">
                Needed only when the remote server is another Tapes desktop app:
                paste the token from its pairing URL (the <code>pt</code>{' '}
                value). Without it this device can browse what it has synced,
                but cannot play recordings whose audio only that host holds.
              </p>
            </>
          )}
          {resolvedSyncServerMode === 'embedded' && (
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={syncServerLanEnabled === 'true'}
                  onChange={async (event) => {
                    const enabled = event.target.checked
                    const info = (await appContext.ipc.send<
                      SyncServerInfo | undefined
                    >('sync:set-lan-enabled', {
                      data: { enabled },
                    })) as SyncServerInfo | undefined

                    if (!info) {
                      console.error('No response from sync:set-lan-enabled')
                      return
                    }

                    setSyncServerLanEnabled(enabled ? 'true' : 'false')
                  }}
                />
                Share with other devices on this network
              </label>
              <p className="pl-2 text-xs text-zinc-500">
                Anyone on your local network can connect while this is enabled.
                Open the app URL below on another device to browse the synced
                recording library — no install needed.
              </p>
              {syncServerLanEnabled === 'true' && (
                <>
                  <label className="flex items-center gap-2 pl-2">
                    <input
                      type="checkbox"
                      checked={syncServerHttpsEnabled === 'true'}
                      onChange={async (event) => {
                        const enabled = event.target.checked
                        const info = (await appContext.ipc.send<
                          SyncServerInfo | undefined
                        >('sync:set-https-enabled', {
                          data: { enabled },
                        })) as SyncServerInfo | undefined

                        if (!info) {
                          console.error(
                            'No response from sync:set-https-enabled',
                          )
                          return
                        }

                        // The server's scheme (ws/wss) changed, so this device's
                        // own connection URL is now stale. Written last, because
                        // that write is what tells the shell to re-resolve the
                        // server info and reconnect the repo to the new url.
                        setSyncServerHttpsEnabled(enabled ? 'true' : 'false')
                      }}
                    />
                    Use HTTPS (lets guests play back and record)
                  </label>
                  <p className="pl-2 text-xs text-zinc-500">
                    Guests need a secure connection to play back or record
                    audio. With HTTPS on, a guest accepts a one-time certificate
                    warning (the certificate is self-signed by this device),
                    then gets full functionality. Without it, guests can only
                    browse the library.
                  </p>
                </>
              )}
              {syncServerLanEnabled === 'true' && guestUrl && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <QRCodeSVG value={guestUrl} />
                  <p>or</p>
                  <Button
                    className="p-2"
                    title="Copy URL to clipboard"
                    onClick={() => {
                      navigator.clipboard.writeText(guestUrl)
                    }}
                  >
                    Copy URL <MdOutlineContentCopy />
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <div className="flex flex-col gap-4">
        <p className="text-sm">Import data from another device:</p>

        <div className="flex w-full items-center justify-between gap-5">
          <TextInput
            label="Paste the host URL here"
            type="text"
            name="import-url"
            id="import-url"
            onChange={(e) => setImportUrl(e.target.value)}
            validate={(value) => {
              try {
                const automergeImportUrl = new URL(value).searchParams.get('am')
                if (!isValidAutomergeUrl(automergeImportUrl)) {
                  return 'Invalid URL'
                }
                return undefined
              } catch {
                return 'Invalid URL'
              }
            }}
          />
          <Button
            className="w-fit rounded-full p-2"
            title="Import data"
            onClick={() => {
              const automergeImportUrl = new URL(importUrl).searchParams.get(
                'am',
              )
              if (!isValidAutomergeUrl(automergeImportUrl)) {
                console.error('Invalid Automerge URL')
                return
              }
              setAutomergeUrl(automergeImportUrl)
            }}
          >
            <MdOutlineFileUpload />
          </Button>
        </div>
      </div>
    </div>
  )
}
