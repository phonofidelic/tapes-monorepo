import { useEffect, useEffectEvent, useState } from 'react'
import { keyFingerprint } from '@tapes-monorepo/provenance'
import { isValidPin, type RosterPerson } from '@tapes-monorepo/sync-protocol'
import type { BlobEndpoint } from '@/blobClient'
import { useAppContext } from '@/context/AppContext'
import { useSetting } from '@/context/SettingsContext'
import { resolveDeviceLabel } from '@/deviceLabel'
import { readLocalDeviceKey } from '@/localDeviceKey'
import { markPersonKeyJoined, type PersonKeyStatus } from '@/personKey'
import {
  acceptVouch,
  askForVouch,
  readVouchStatus,
  tryPin,
  type VouchAcceptance,
} from '@/rosterClient'
import { PromptFrame } from './PromptFrame'
import { RestoreFlow } from './RestoreFlow'

/**
 * A guest with no keys, on a host that already knows people. The person picks
 * their name, restores their person key from its backup, or says they are new.
 * A returning person who picked their name waits for the operator to confirm
 * them, or types their PIN, and the host vouches for this device.
 *
 * The vouch is kept only if the host key pinned from the QR link signed it.
 */

/** How often a waiting device asks whether the operator has answered. */
export const VOUCH_POLL_MS = 2000

export function WelcomeBackFlow({
  worker,
  endpoint,
  roster,
  onNew,
  onIdentified,
  onLater,
}: {
  worker: Worker
  endpoint: BlobEndpoint
  roster: RosterPerson[]
  onNew: () => Promise<void>
  /** This device now has a person key or the host's vouch. */
  onIdentified: (status: PersonKeyStatus) => void
  onLater: () => void
}) {
  const [person, setPerson] = useState<RosterPerson>()
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string>()

  if (restoring) {
    return (
      <RestoreFlow
        worker={worker}
        onCancel={() => setRestoring(false)}
        onRestored={(status) => {
          // A person the host already knows needs no join step.
          const known =
            status.exists &&
            !status.joinedAt &&
            roster.some((entry) => entry.personKey === status.publicKey)
          if (!known) {
            onIdentified(status)
            return
          }
          markPersonKeyJoined(worker).then(
            ({ joinedAt }) => onIdentified({ ...status, joinedAt }),
            () => onIdentified(status),
          )
        }}
      />
    )
  }
  if (person) {
    return (
      <RejoinFlow
        worker={worker}
        endpoint={endpoint}
        person={person}
        onVouched={onIdentified}
        onBack={(message) => {
          setError(message)
          setPerson(undefined)
        }}
      />
    )
  }
  return (
    <PromptFrame title="Have you been here before?">
      <p>
        This phone has no keys for this host yet. If the host knows you, pick
        your name and it will vouch for this phone.
      </p>
      <ul className="flex flex-col gap-1">
        {roster.map((entry) => (
          <li key={entry.personKey}>
            <button
              className="w-full rounded-md bg-zinc-800 px-3 py-2 text-left hover:bg-zinc-700"
              onClick={() => {
                setError(undefined)
                setPerson(entry)
              }}
            >
              {entry.name}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={onLater}
        >
          Not now
        </button>
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={() => {
            setError(undefined)
            setRestoring(true)
          }}
        >
          Restore from a backup
        </button>
        <button
          className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200"
          onClick={() => void onNew()}
        >
          I&apos;m new here
        </button>
      </div>
    </PromptFrame>
  )
}

/** Words for a vouch the worker would not keep. */
function acceptanceError(
  problem: Extract<VouchAcceptance, { ok: false }>['problem'],
) {
  return problem === 'no-pinned-host' || problem === 'other-host'
    ? "That answer did not come from the host you scanned. Scan the host's QR code again."
    : 'The host answered with something this phone cannot use. Try again.'
}

/** This device's key fingerprint, which the operator sees next to the request. */
function useDeviceFingerprint(): string | undefined {
  const appContext = useAppContext()
  const [fingerprint, setFingerprint] = useState<string>()
  useEffect(() => {
    let current = true
    readLocalDeviceKey(appContext)
      .then((key) => (key ? keyFingerprint(key) : undefined))
      .then(
        (value) => current && setFingerprint(value),
        () => undefined,
      )
    return () => {
      current = false
    }
  }, [appContext])
  return fingerprint
}

export function RejoinFlow({
  worker,
  endpoint,
  person,
  onVouched,
  onBack,
}: {
  worker: Worker
  endpoint: BlobEndpoint
  person: RosterPerson
  onVouched: (status: PersonKeyStatus) => void
  /** Back to the list of names, with what went wrong if anything did. */
  onBack: (error?: string) => void
}) {
  const [pinnedHostKey] = useSetting('pinnedHostKey')
  const [id, setId] = useState<string>()
  const [pinOpen, setPinOpen] = useState(person.hasPin && !person.pinLocked)
  const [pin, setPin] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string>()
  const fingerprint = useDeviceFingerprint()

  const accept = async (vouch: string) => {
    const result = await acceptVouch(worker, vouch, pinnedHostKey)
    if (result.ok) {
      onVouched(result.status)
    } else {
      onBack(acceptanceError(result.problem))
    }
  }
  // Effect events, so a parent's new callbacks do not restart the request.
  const goBack = useEffectEvent((message: string) => onBack(message))
  const acceptVouched = useEffectEvent((vouch: string) => void accept(vouch))

  useEffect(() => {
    let current = true
    askForVouch(worker, endpoint, {
      personKey: person.personKey,
      deviceLabel: resolveDeviceLabel({ storage: localStorage, navigator }),
    }).then(
      (requestId) => current && setId(requestId),
      (cause: unknown) => {
        console.error('Could not ask the host for a vouch:', cause)
        if (current) {
          goBack('The host did not take the request. Try again.')
        }
      },
    )
    return () => {
      current = false
    }
  }, [worker, endpoint, person.personKey])

  // Waits for the operator, whether or not a PIN is also on offer.
  useEffect(() => {
    if (!id) {
      return
    }
    let current = true
    const timer = setInterval(() => {
      readVouchStatus(endpoint, id).then(
        (status) => {
          if (!current) {
            return
          }
          if (!status) {
            clearInterval(timer)
            goBack('The request timed out. Pick your name again.')
          } else if (status.status === 'rejected') {
            clearInterval(timer)
            goBack('The host said no. Pick your name again, or ask the host.')
          } else if (status.status === 'vouched') {
            clearInterval(timer)
            acceptVouched(status.vouch)
          }
        },
        (cause: unknown) => console.warn('Could not read the vouch:', cause),
      )
    }, VOUCH_POLL_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [endpoint, id])

  const submitPin = async () => {
    if (!id || !isValidPin(pin)) {
      return
    }
    setChecking(true)
    setError(undefined)
    try {
      const result = await tryPin(endpoint, id, pin)
      if (result.ok) {
        await accept(result.vouch)
        return
      }
      setPin('')
      if (result.error === 'wrong-pin') {
        setError(
          result.attemptsLeft === 1
            ? 'Wrong PIN. 1 try left.'
            : `Wrong PIN. ${result.attemptsLeft} tries left.`,
        )
      } else {
        setPinOpen(false)
        setError(
          result.error === 'locked'
            ? 'Too many wrong PINs. Ask the host to confirm you instead.'
            : 'The PIN cannot be used. Ask the host to confirm you instead.',
        )
      }
    } catch (cause) {
      console.error('Could not check the PIN:', cause)
      setError('The PIN could not be checked. Try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <PromptFrame title={`Welcome back, ${person.name}`}>
      {pinOpen ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submitPin()
          }}
        >
          <label className="flex flex-col gap-1">
            Your PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, ''))
              }
              className="rounded-md bg-zinc-800 px-2 py-1.5 text-zinc-50"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
              disabled={!id || checking || !isValidPin(pin)}
            >
              {checking ? 'Checking…' : 'Use PIN'}
            </button>
          </div>
          <p className="text-xs text-zinc-400">
            Or ask the host to confirm you. This phone is waiting for them too.
          </p>
        </form>
      ) : (
        <p role="status">Waiting for the host to confirm you…</p>
      )}
      {fingerprint && (
        <p className="text-xs text-zinc-400">
          The host sees this phone as key {fingerprint}.
        </p>
      )}
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={() => onBack()}
        >
          That&apos;s not me
        </button>
      </div>
    </PromptFrame>
  )
}
