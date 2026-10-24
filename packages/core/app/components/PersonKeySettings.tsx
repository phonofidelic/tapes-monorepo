import { useEffect, useState } from 'react'
import { Button } from '@tapes-monorepo/ui'
import { useAppContext } from '@/context/AppContext'
import { readPersonKeyStatus, type PersonKeyStatus } from '@/personKey'
import { RestoreFlow } from './RestoreFlow'

/**
 * A web guest's person key in Settings: whether this device has it, and a way
 * to restore it from the backup. A device the host vouched for has no person
 * key, and restoring is how it gets one back.
 */
export function PersonKeySettings() {
  const appContext = useAppContext()
  const [status, setStatus] = useState<PersonKeyStatus>()
  const [restoring, setRestoring] = useState(false)

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
