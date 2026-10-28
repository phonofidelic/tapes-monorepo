import { useState } from 'react'
import { keyFingerprint, toBase64Url } from '@tapes-monorepo/provenance'
import { Button } from '@tapes-monorepo/ui'
import {
  runPasskeyCeremony,
  type CeremonyAction,
  type CeremonyProblem,
} from '@/personKeyCeremony'

/**
 * Checks that the passkey page answers a guest served from the host's LAN IP.
 * It makes a passkey, or uses one that exists, and shows what came back.
 * Nothing is wrapped and nothing is stored. Passkey recovery itself is still
 * to come.
 *
 * The check is behind `?passkey=1` because it is for testing the handoff on a
 * real phone, not a thing to offer people.
 */

/** Whether to show the check at all. */
export function passkeyCheckEnabled(search: string): boolean {
  return new URLSearchParams(search).get('passkey') === '1'
}

const problems: Record<CeremonyProblem, string> = {
  blocked: 'The browser blocked the new tab. Allow pop-ups for this page.',
  closed: 'The tab closed before it answered.',
  timeout: 'Nothing came back in time.',
  declined: 'Cancelled on the passkey page.',
  unsupported: 'This browser cannot make a passkey.',
  'no-prf': 'The passkey works, but it returns no PRF output.',
  failed: 'The passkey page could not finish.',
}

export function PasskeyCheck({
  hostName,
  personPublicKey,
}: {
  hostName: string
  /** Base64url, so one person gets one passkey rather than one per device. */
  personPublicKey?: string
}) {
  const [running, setRunning] = useState<CeremonyAction>()
  const [said, setSaid] = useState<string>()

  // The tab has to open inside this click, so the ceremony is called before
  // any await.
  const check = (action: CeremonyAction) => {
    setSaid(undefined)
    setRunning(action)
    runPasskeyCeremony({ action, hostName, userId: personPublicKey }, {}).then(
      async (outcome) => {
        if (!outcome.ok) {
          setSaid(problems[outcome.problem])
        } else {
          // A short hash of the PRF output, not the output. Two phones holding
          // the same synced passkey should show the same one.
          const prf = await keyFingerprint(toBase64Url(outcome.prf))
          outcome.prf.fill(0)
          setSaid(
            `A passkey answered for ${outcome.rpId}. Credential ${outcome.credentialId.slice(0, 8)}…, PRF ${prf}.`,
          )
        }
        setRunning(undefined)
      },
      (error: unknown) => {
        console.warn('The passkey check failed:', error)
        setSaid(problems.failed)
        setRunning(undefined)
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Passkey page</h3>
      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit p-2"
          disabled={running !== undefined}
          onClick={() => check('create')}
        >
          {running === 'create' ? 'Waiting…' : 'Make a passkey'}
        </Button>
        <Button
          className="w-fit p-2"
          disabled={running !== undefined}
          onClick={() => check('get')}
        >
          {running === 'get' ? 'Waiting…' : 'Use a passkey'}
        </Button>
      </div>
      {said && <p className="pl-2 text-sm">{said}</p>}
    </div>
  )
}
