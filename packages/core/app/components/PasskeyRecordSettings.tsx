import { useState } from 'react'
import { Button } from '@tapes-monorepo/ui'
import type { BlobEndpoint } from '@/blobClient'
import { storePasskeyRecord } from '@/passkeyRecordClient'
import { runPasskeyCeremony, type CeremonyProblem } from '@/personKeyCeremony'

/**
 * Keeps a copy of this device's person key on the host, locked by a passkey.
 * A replacement phone unlocks it with the same passkey, which the person's
 * password manager has synced there.
 *
 * It is a second way back, not a replacement for the passphrase backup.
 * Deleting the passkey destroys what it unlocks, and some password managers
 * return no PRF output at all.
 */

export const ceremonyProblems: Record<CeremonyProblem, string> = {
  blocked: 'The browser blocked the new tab. Allow pop-ups for this page.',
  closed: 'The tab closed before it answered.',
  timeout: 'Nothing came back in time.',
  declined: 'Cancelled on the passkey page.',
  unsupported: 'This browser cannot make a passkey.',
  'no-prf':
    'This passkey cannot hold a key for Tapes. Your passphrase backup is the way through.',
  failed: 'The passkey page could not finish.',
}

export function PasskeyRecordSettings({
  worker,
  endpoint,
  hostName,
  personPublicKey,
  recordedAt,
  onRecorded,
}: {
  worker: Worker
  endpoint: BlobEndpoint
  /** Shown on the passkey page as the host asking. */
  hostName: string
  /** Base64url, so one person gets one passkey rather than one per device. */
  personPublicKey: string
  /** When this device last wrote a record, if it has. */
  recordedAt?: string
  onRecorded: (at: string) => void
}) {
  const [running, setRunning] = useState(false)
  const [said, setSaid] = useState<{ text: string; error: boolean }>()

  // The tab has to open inside this click, so the ceremony is called before
  // any await.
  const protect = () => {
    setSaid(undefined)
    setRunning(true)
    runPasskeyCeremony(
      { action: 'create', hostName, userId: personPublicKey },
      {},
    ).then(
      async (outcome) => {
        if (!outcome.ok) {
          setSaid({ text: ceremonyProblems[outcome.problem], error: true })
          setRunning(false)
          return
        }
        try {
          const result = await storePasskeyRecord(worker, endpoint, outcome)
          if (result.ok) {
            onRecorded(result.passkeyRecordedAt)
            setSaid({
              text: 'Your passkey can now bring this key back on a new phone.',
              error: false,
            })
          } else {
            setSaid({ text: refusal(result.detail, hostName), error: true })
          }
        } finally {
          outcome.prf.fill(0)
          setRunning(false)
        }
      },
      (error: unknown) => {
        console.warn('The passkey record failed:', error)
        setSaid({ text: ceremonyProblems.failed, error: true })
        setRunning(false)
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Passkey</h3>
      <p className="pl-2 text-sm">
        {recordedAt
          ? `${hostName} holds a copy of your person key for your passkey.`
          : `Let a passkey bring your person key back on a new phone. ${hostName} holds the locked copy.`}
      </p>
      <Button className="w-fit p-2" disabled={running} onClick={protect}>
        {running
          ? 'Waiting…'
          : recordedAt
            ? 'Use another passkey'
            : 'Protect with a passkey'}
      </Button>
      {said && (
        <p
          className={said.error ? 'pl-2 text-sm text-rose-500' : 'pl-2 text-sm'}
          role={said.error ? 'alert' : 'status'}
        >
          {said.text}
        </p>
      )}
    </div>
  )
}

function refusal(detail: string | undefined, hostName: string): string {
  if (detail === 'unknown-person') {
    return `${hostName} does not have you on its roster yet.`
  }
  if (detail === 'too-many-records') {
    return 'This host already holds records for all your passkeys.'
  }
  if (detail === 'not-yours') {
    return 'Another person already uses that passkey here.'
  }
  return `${hostName} would not keep the record. Try again.`
}
