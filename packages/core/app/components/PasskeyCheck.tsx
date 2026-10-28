import { useState } from 'react'
import { Button } from '@tapes-monorepo/ui'
import {
  runPasskeyCeremony,
  type CeremonyOutcome,
  type CeremonyProblem,
} from '@/personKeyCeremony'

/**
 * Checks that the passkey page answers a guest served from the host's LAN IP.
 * It makes a passkey and shows what came back. Nothing is wrapped, nothing is
 * stored, and the PRF output is not displayed. Passkey recovery itself is
 * still to come.
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
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<CeremonyOutcome>()

  // The tab has to open inside this click, so the ceremony is called before
  // any await.
  const check = () => {
    setOutcome(undefined)
    setRunning(true)
    runPasskeyCeremony(
      { action: 'create', hostName, userId: personPublicKey },
      {},
    ).then(
      (next) => {
        setOutcome(next)
        setRunning(false)
      },
      (error: unknown) => {
        console.warn('The passkey check failed:', error)
        setOutcome({ ok: false, problem: 'failed' })
        setRunning(false)
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Passkey page</h3>
      <Button className="w-fit p-2" disabled={running} onClick={check}>
        {running ? 'Waiting for the passkey page…' : 'Check the passkey page'}
      </Button>
      {outcome && (
        <p className="pl-2 text-sm">
          {outcome.ok
            ? `A passkey answered for ${outcome.rpId}. Credential ${outcome.credentialId.slice(0, 8)}…, with ${outcome.prf.length} bytes of PRF output.`
            : problems[outcome.problem]}
        </p>
      )}
    </div>
  )
}
