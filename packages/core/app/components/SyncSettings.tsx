import { useEffect, useState } from 'react'
import { useAppContext } from '@/context/AppContext'
import { useSetting } from '@/context/SettingsContext'
import {
  deriveDeviceLabel,
  FALLBACK_DEVICE_LABEL,
  MAX_DEVICE_LABEL_LENGTH,
  sanitizeDeviceLabel,
} from '@/deviceLabel'
import { SyncConnection, SyncServerInfo } from '@/IpcService'
import { buildGuestUrl, buildTrustPageUrl, formatFingerprint } from '@/pairing'
import { useConnectedDevices } from '@/hooks/useConnectedDevices'
import { isSyncServerUrl, useAutomergeUrl } from '@/utils'
import { isValidAutomergeUrl } from '@automerge/automerge-repo'
import { Button, TextInput } from '@tapes-monorepo/ui'
import { QRCodeSVG } from 'qrcode.react'
import { MdOutlineContentCopy, MdOutlineFileUpload } from 'react-icons/md'

export function SyncSettings() {
  const appContext = useAppContext()

  // Guests only. The desktop app is the host. It minted the root and already
  // trusts it.
  const trustPageUrl =
    appContext.type === 'web-client'
      ? buildTrustPageUrl(window.location.search)
      : null

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg">Sync</h2>

      {trustPageUrl && (
        <div className="flex flex-col gap-1">
          <a className="text-sm underline" href={trustPageUrl}>
            Install this host&rsquo;s certificate
          </a>
          <p className="pl-2 text-xs text-zinc-500">
            Stops the browser warning on this device, and keeps it away when the
            host moves to another address on the network. The page compares the
            certificate against the code you scanned before it offers to install
            anything.
          </p>
        </div>
      )}
      {appContext.type === 'electron-client' && <HostSettings />}
      <GuestSettings />
    </div>
  )
}

function HostSettings() {
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
  const { automergeUrl } = useAutomergeUrl()
  const [serverInfo, setServerInfo] = useState<SyncServerInfo | null>(null)
  const [remoteUrlDraft, setRemoteUrlDraft] = useState(
    remoteSyncServerUrl ?? '',
  )
  const [tokenDraft, setTokenDraft] = useState(pairingToken ?? '')

  const resolvedSyncServerMode = syncServerMode ?? 'embedded'

  // Reads the server's own address, token and fingerprint. The LAN and HTTPS
  // toggles change all three, so they are deps rather than one-time reads.
  // Who is connected is not read here: `ConnectedDevices` asks for that.
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
    resolvedSyncServerMode === 'embedded'
      ? buildGuestUrl({
          lanWebAppUrl: serverInfo?.lanWebAppUrl,
          automergeUrl,
          pairingToken: serverInfo?.pairingToken,
          rootCertFingerprint: serverInfo?.rootCertFingerprint,
        })
      : null

  const rootFingerprint = serverInfo?.rootCertFingerprint
    ? formatFingerprint(serverInfo.rootCertFingerprint)
    : null

  if (appContext.type !== 'electron-client') {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-muted">Host settings</h3>

      <label className="flex flex-col gap-2 text-sm">
        Sync server:
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
                if (isSyncServerUrl(remoteUrlDraft)) {
                  setRemoteSyncServerUrl(remoteUrlDraft)
                }
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
                setPairingToken(tokenDraft === '' ? undefined : tokenDraft)
              }}
            >
              Save
            </Button>
          </div>
          <p className="pl-2 text-xs text-zinc-500">
            Needed only when the remote server is another Tapes desktop app:
            paste the token from its pairing URL (the <code>pt</code> value).
            Without it this device can browse what it has synced, but cannot
            play recordings whose audio only that host holds.
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
            Anyone on your local network can connect while this is enabled. Open
            the app URL below on another device to browse the synced recording
            library — no install needed.
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
                      console.error('No response from sync:set-https-enabled')
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
                Guests need a secure connection to play back or record audio.
                With HTTPS on, a guest accepts a one-time certificate warning
                (the certificate is self-signed by this device), then gets full
                functionality. Without it, guests can only browse the library.
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
              {rootFingerprint && (
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xs text-zinc-500">
                    Certificate fingerprint. The guest shows this after
                    downloading the certificate. If the two do not match, do not
                    install it.
                  </p>
                  <code className="max-w-full text-center font-mono text-xs break-all">
                    {rootFingerprint}
                  </code>
                </div>
              )}
            </div>
          )}
          <ConnectedDevices />
        </div>
      )}
    </div>
  )
}

/**
 * Who is connected to this host's sync server.
 *
 * Rendered only under the embedded-mode branch above. `useConnectedDevices`
 * subscribes as soon as it has an ipc service, so a host pointed at a remote
 * server must not reach this component at all: it would ask a question this
 * device has no server to answer.
 */
function ConnectedDevices() {
  const { connections, status, refresh } = useConnectedDevices()

  // Nothing to say yet. An empty panel beats a list that is about to be
  // replaced, and `unsupported` cannot happen from a host-only call site.
  if (status === 'loading' || status === 'unsupported') {
    return null
  }

  if (status === 'unavailable') {
    return (
      <ConnectedDevicesEmptyOrErrorMessage
        title="Can't tell who is connected."
        body="Tapes lost contact with its sync server, so this list may be wrong. It returns on its own once contact is back, or you can ask again."
      >
        <Button
          className="w-fit p-2"
          title="Ask the host again"
          onClick={refresh}
        >
          Try again
        </Button>
      </ConnectedDevicesEmptyOrErrorMessage>
    )
  }

  const hostConnection = connections.find((connection) => connection.self)
  const guestConnections = connections.filter((connection) => !connection.self)

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm">Connected devices:</h4>
      <div className="flex flex-col gap-2">
        {hostConnection && <ConnectionRow connection={hostConnection} />}

        {guestConnections.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {guestConnections.map((guestConnection) => (
              <li key={guestConnection.id}>
                <ConnectionRow connection={guestConnection} />
              </li>
            ))}
          </ul>
        ) : (
          <ConnectedDevicesEmptyOrErrorMessage
            title="No guest devices connected."
            body="Show the QR code above to a phone or laptop on this network, or send it the link. A device appears here the moment it connects."
          />
        )}
      </div>
    </div>
  )
}

function ConnectedDevicesEmptyOrErrorMessage({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <p>{title}</p>
      <p className="text-muted text-sm">{body}</p>
      {children}
    </div>
  )
}

function ConnectionRow({ connection }: { connection: SyncConnection }) {
  const getFormattedDuration = (connectedAt: number) =>
    new Intl.DurationFormat('en', {
      style: 'long',
    }).format(
      Temporal.Now.instant().since(
        Temporal.Instant.fromEpochMilliseconds(connectedAt),
        {
          smallestUnit: 'minutes',
          largestUnit: 'hours',
        },
      ),
    )
  const [formattedDuration, setFormattedDuration] = useState(() =>
    getFormattedDuration(connection.connectedAt),
  )

  useEffect(() => {
    const connectionDurationInterval = setInterval(
      () => setFormattedDuration(getFormattedDuration(connection.connectedAt)),
      60_000,
    )

    return () => {
      clearInterval(connectionDurationInterval)
    }
  }, [connection.connectedAt])

  return (
    <div className="border-subtle bg-surface flex gap-3 rounded-sm border px-3 py-2">
      <div className="flex items-center">
        <div className="size-2 rounded-full bg-green-400" />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex gap-2">
          <p>{connection.label ?? FALLBACK_DEVICE_LABEL}</p>
          {connection.self && (
            <div className="bg-subtle rounded-full px-2 py-0.5 text-xs">
              This device
            </div>
          )}
        </div>
        <p className="text-muted">
          Connected{' '}
          {formattedDuration.length > 0
            ? formattedDuration + ' ago'
            : 'just now'}
          {connection.address && ` · ${connection.address}`}
        </p>
      </div>
    </div>
  )
}

function GuestSettings() {
  const [, setPairingToken] = useSetting('pairingToken')
  const { automergeUrl, setAutomergeUrl } = useAutomergeUrl()
  const [importUrl, setImportUrl] = useState<string | null>(null)
  const [importUrlError, setImportUrlError] = useState<string | null>(null)
  const [importedUrl, setImportedUrl] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-muted text-base">Guest settings</h3>
      <p className="text-sm">Import data from another device:</p>

      <div className="flex w-full items-center justify-between gap-5">
        <TextInput
          label="Paste the host URL here"
          type="text"
          name="import-url"
          id="import-url"
          onChange={(e) => {
            setImportUrl(e.target.value)
            setImportedUrl(null)
          }}
          validate={(value) => {
            try {
              const automergeImportUrl = new URL(value).searchParams.get('am')
              if (!isValidAutomergeUrl(automergeImportUrl)) {
                setImportUrlError('Invalid URL')
                return 'Invalid Automerge URL'
              }
              setImportUrlError(null)
              return undefined
            } catch {
              setImportUrlError('Invalid URL')
              return 'Invalid URL'
            }
          }}
        />
        <Button
          className="w-fit rounded-full p-2"
          title="Import data"
          disabled={!importUrl || importUrlError !== null}
          onClick={() => {
            if (!importUrl) {
              console.error('A host URL is required')
              setImportUrlError('A host URL is required')
              return
            }
            let parsedImportUrl: URL

            try {
              parsedImportUrl = new URL(importUrl)
            } catch {
              console.error('Invalid URL')
              setImportUrlError('Invalid URL')
              return
            }

            const automergeImportUrl = parsedImportUrl.searchParams.get('am')
            if (!isValidAutomergeUrl(automergeImportUrl)) {
              console.error('Invalid Automerge URL')
              setImportUrlError('Invalid Automerge URL')
              return
            }

            // A pairing link carries the host's token alongside the document
            // it points at, and that token is what opens the host's sync
            // socket and its `/blobs`. Pasting the link here used to drop it,
            // so the import resolved to a document this device had no way to
            // fetch: keep it, as the guest bootstrap does when the same link
            // is opened directly.
            const importedToken = parsedImportUrl.searchParams.get('pt')
            if (importedToken) {
              setPairingToken(importedToken)
            }

            // Written last: the shells key their repo on this url, so this is
            // the write that reconnects them to the imported document.
            setAutomergeUrl(automergeImportUrl)
            setImportedUrl(automergeImportUrl)
          }}
        >
          <MdOutlineFileUpload />
        </Button>
      </div>
      {importedUrl && importedUrl === automergeUrl && (
        <p className="text-xs text-zinc-500" role="status" aria-live="polite">
          Imported. This device now reads the library from that device — open
          Library to see it.
        </p>
      )}
      <DeviceLabelSetting />
    </div>
  )
}

/**
 * Names this device for the hosts it syncs with. The name is sent on the socket
 * handshake (see `deviceLabel.ts`), so a host can list its guests by something
 * a person recognises. It is stored per device, not in the Automerge document.
 */
function DeviceLabelSetting() {
  const [deviceLabel, setDeviceLabel] = useSetting('deviceLabel')
  const [labelDraft, setLabelDraft] = useState(deviceLabel ?? '')

  // Shown, not written. A device that has never been renamed keeps tracking
  // the derived name instead of freezing the first one it saw.
  const derivedLabel = deriveDeviceLabel(
    typeof navigator === 'undefined' ? undefined : navigator,
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="flex w-full items-center justify-between gap-5 text-sm">
        <TextInput
          label="This device's name"
          type="text"
          name="device-label"
          id="device-label"
          value={labelDraft}
          onChange={(event) =>
            setLabelDraft(event.target.value.slice(0, MAX_DEVICE_LABEL_LENGTH))
          }
        />
        <Button
          className="w-fit p-2"
          title="Save device name"
          onClick={() => {
            // An empty field means "use the default". That is an absent key,
            // not a stored empty string.
            setDeviceLabel(sanitizeDeviceLabel(labelDraft))
          }}
        >
          Save
        </Button>
      </div>
      <p className="pl-2 text-xs text-zinc-500">
        How this device names itself to a host it syncs with. Leave it empty to
        use <span className="text-zinc-400">{derivedLabel}</span>. The host sees
        a new name the next time this device connects.
      </p>
    </div>
  )
}
