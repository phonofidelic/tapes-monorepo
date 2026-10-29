import { useEffect, useState } from 'react'
import { Button } from '@tapes-monorepo/ui'
import { useAppContext } from '@/context/AppContext'
import { useSetting } from '@/context/SettingsContext'
import { useUploadEndpoint } from '@/context/BlobContext'
import { useRosterSelf } from '@/hooks/useRosterSelf'
import { readPersonKeyStatus, type PersonKeyStatus } from '@/personKey'
import { PasskeyRecordSettings } from './PasskeyRecordSettings'
import { PinSettings } from './PinSettings'
import { RejoinFlow } from './RejoinFlow'
import { RestoreFlow } from './RestoreFlow'

/**
 * A web guest's person key in Settings: whether this device has it, and the
 * two ways back for a device the host vouched for instead. Restoring the
 * person key from its backup gives this device a certificate of its own.
 * Asking the host again gets a fresh vouch, which this device needs once the
 * operator withdrew the one it holds. Below both, the person's PIN on the host.
 *
 * A device that holds the person key can also leave a passkey-locked copy on
 * the host, which is the other way back on a phone that has nothing.
 */
export function PersonKeySettings() {
  const appContext = useAppContext()
  const [status, setStatus] = useState<PersonKeyStatus>()
  const [restoring, setRestoring] = useState(false)
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean }>()
  const [pairedHostName] = useSetting('pairedHostName')
  const endpoint = useUploadEndpoint()

  const identified = status?.exists ? status : undefined
  const vouchedBy = identified?.vouchedBy
  // Only a device without a person key of its own asks to be vouched for.
  const { self } = useRosterSelf(
    vouchedBy ? endpoint : undefined,
    identified?.publicKey,
  )

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
      {vouchedBy && self === null && (
        <p className="pl-2 text-sm">
          {vouchedBy} no longer has you on its roster, so it cannot vouch for
          this device. Ask the host in person.
        </p>
      )}
      {vouchedBy && self && (
        <Button
          className="w-fit p-2"
          onClick={() => {
            setMessage(undefined)
            setAsking(true)
          }}
        >
          {`Ask ${vouchedBy} to vouch again`}
        </Button>
      )}
      {message && (
        <p
          className={
            message.error ? 'pl-2 text-sm text-rose-500' : 'pl-2 text-sm'
          }
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
      {identified && !identified.vouchedBy && endpoint && (
        <PasskeyRecordSettings
          worker={appContext.worker}
          endpoint={endpoint}
          hostName={pairedHostName ?? window.location.host}
          personPublicKey={identified.publicKey}
          recordedAt={identified.passkeyRecordedAt}
          onRecorded={(passkeyRecordedAt) =>
            setStatus({ ...identified, passkeyRecordedAt })
          }
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
          endpoint={endpoint}
          hostName={pairedHostName ?? window.location.host}
          onCancel={() => setRestoring(false)}
          onRestored={(next) => {
            setStatus(next)
            setRestoring(false)
          }}
        />
      )}
      {asking && self && endpoint && (
        <RejoinFlow
          worker={appContext.worker}
          endpoint={endpoint}
          person={self}
          title={`Ask ${vouchedBy} to vouch again`}
          cancelLabel="Not now"
          onVouched={(next) => {
            setStatus(next)
            setAsking(false)
            setMessage({
              text: 'This device has a new vouch. The old one still stands for the takes it signed.',
              error: false,
            })
          }}
          onBack={(error) => {
            setAsking(false)
            if (error) {
              setMessage({ text: error, error: true })
            }
          }}
        />
      )}
    </div>
  )
}
