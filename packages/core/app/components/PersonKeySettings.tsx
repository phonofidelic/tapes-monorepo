import { useEffect, useState } from 'react'
import { Button } from '@tapes-monorepo/ui'
import { useAppContext } from '@/context/AppContext'
import { useSetting } from '@/context/SettingsContext'
import { useUploadEndpoint } from '@/context/BlobContext'
import { readPersonKeyStatus, type PersonKeyStatus } from '@/personKey'
import { PasskeyCheck, passkeyCheckEnabled } from './PasskeyCheck'
import { PinSettings } from './PinSettings'
import { RestoreFlow } from './RestoreFlow'

/**
 * A web guest's person key in Settings: whether this device has it, and a way
 * to restore it from the backup. A device the host vouched for has no person
 * key, and restoring is how it gets one back. Below it, the person's PIN on
 * the host, once the host has them on its roster.
 *
 * `?passkey=1` adds a check that the passkey page answers this origin. It is
 * for testing that handoff on a phone, not a thing to offer people.
 */
export function PersonKeySettings() {
  const appContext = useAppContext()
  const [status, setStatus] = useState<PersonKeyStatus>()
  const [restoring, setRestoring] = useState(false)
  const [pairedHostName] = useSetting('pairedHostName')
  const endpoint = useUploadEndpoint()

  useEffect(() => {
    let current = true
    readPersonKeyStatus(appContext).then(
      (next) => current && setStatus(next),
      (error: unknown) => console.warn('Could not read the person key:', error),
    )
    return () => {
      current = false
    }
  }, [appContext])

  if (appContext.type !== 'web-client' || !status) {
    return null
  }
  // A device that holds the person key has nothing to restore.
  const canRestore = !status.exists || status.vouchedBy !== undefined

  return (
    <div className="flex flex-col gap-2">
      <h2>Your person key</h2>
      <p className="pl-2 text-sm">
        {!status.exists
          ? 'This device has no person key.'
          : status.vouchedBy
            ? `This device has no person key. ${status.vouchedBy} vouched for it.`
            : status.backedUpAt
              ? 'This device has your person key, and it is backed up.'
              : 'This device has your person key. It is not backed up yet.'}
      </p>
      {canRestore && (
        <Button className="w-fit p-2" onClick={() => setRestoring(true)}>
          Restore from a backup
        </Button>
      )}
      {passkeyCheckEnabled(window.location.search) && (
        <PasskeyCheck
          hostName={
            pairedHostName ??
            ((status.exists && status.vouchedBy) || window.location.host)
          }
          personPublicKey={status.exists ? status.publicKey : undefined}
        />
      )}
      {status.exists && endpoint && (
        <PinSettings
          worker={appContext.worker}
          endpoint={endpoint}
          status={status}
        />
      )}
      {restoring && (
        <RestoreFlow
          worker={appContext.worker}
          onCancel={() => setRestoring(false)}
          onRestored={(next) => {
            setStatus(next)
            setRestoring(false)
          }}
        />
      )}
    </div>
  )
}
