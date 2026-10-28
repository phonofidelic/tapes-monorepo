import { useState } from 'react'
import { isValidPin } from '@tapes-monorepo/sync-protocol'
import type { BlobEndpoint } from '@/blobClient'
import { useRosterSelf } from '@/hooks/useRosterSelf'
import type { PersonKeyStatus } from '@/personKey'
import { changePin, joinHostRoster } from '@/rosterClient'

/**
 * A web guest sets, changes or removes their PIN on the host. A device with
 * the person key re-joins with the new PIN, since the person key proves who
 * it is. A vouched device has no person key, so it must give the old PIN.
 * Without either, the host's operator sets the PIN in person.
 */

type Props = {
  worker: Worker
  endpoint: BlobEndpoint
  status: Extract<PersonKeyStatus, { exists: true }>
}

const inputClass = 'rounded-sm bg-transparent p-2 ring-1 ring-zinc-400'
const buttonClass =
  'w-fit rounded-sm p-2 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800'

const digits = (value: string) => value.replace(/\D/g, '')

export function PinSettings({ worker, endpoint, status }: Props) {
  const { self, refresh } = useRosterSelf(endpoint, status.publicKey)
  const [oldPin, setOldPin] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean }>()

  const holdsPersonKey = status.vouchedBy === undefined

  if (!self) {
    return null
  }

  const save = async (next: string | null) => {
    setBusy(true)
    setMessage(undefined)
    try {
      const problem = holdsPersonKey
        ? await saveWithPersonKey(next)
        : await saveWithOldPin(next)
      if (problem) {
        setMessage({ text: problem, error: true })
        return
      }
      setOldPin('')
      setPin('')
      setMessage({
        text: next === null ? 'Your PIN is removed.' : 'Your PIN is saved.',
        error: false,
      })
      refresh()
    } catch (cause) {
      console.error('Could not change the PIN:', cause)
      setMessage({ text: 'That did not go through. Try again.', error: true })
    } finally {
      setBusy(false)
    }
  }

  const saveWithPersonKey = async (next: string | null) => {
    const result = await joinHostRoster(worker, endpoint, {
      personName: self.name,
      pin: next,
    })
    return result.ok
      ? undefined
      : result.problem === 'unreachable'
        ? 'The host did not answer. Check you are on its network.'
        : 'The host did not accept that PIN.'
  }

  const saveWithOldPin = async (next: string | null) => {
    const result = await changePin(endpoint, {
      personKey: self.personKey,
      oldPin,
      pin: next,
    })
    if (result.ok) {
      return undefined
    }
    if (result.error === 'wrong-pin') {
      return `That is not your current PIN. ${result.attemptsLeft} ${
        result.attemptsLeft === 1 ? 'try' : 'tries'
      } left.`
    }
    if (result.error === 'locked') {
      refresh()
      return 'Too many wrong PINs. Ask the host to unlock it.'
    }
    return 'The host did not accept that PIN.'
  }

  if (!holdsPersonKey && !self.hasPin) {
    return (
      <p className="pl-2 text-sm">
        You have no PIN. Ask the host in person to set one for you.
      </p>
    )
  }
  if (!holdsPersonKey && self.pinLocked) {
    return (
      <p className="pl-2 text-sm">
        Your PIN is locked after too many wrong tries. Ask the host in person to
        unlock it.
      </p>
    )
  }

  const needsOldPin = !holdsPersonKey
  const canSave = isValidPin(pin) && (!needsOldPin || isValidPin(oldPin))
  return (
    <form
      className="flex flex-col gap-2 pl-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) {
          void save(pin)
        }
      }}
    >
      <p>
        {self.hasPin
          ? 'Your PIN lets a new device join as you without asking the host.'
          : 'Set a PIN to let a new device join as you without asking the host.'}
      </p>
      {needsOldPin && (
        <label className="flex flex-col gap-1">
          Current PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={oldPin}
            onChange={(event) => setOldPin(digits(event.target.value))}
            className={inputClass}
          />
        </label>
      )}
      <label className="flex flex-col gap-1">
        New PIN, 4 to 6 digits
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(digits(event.target.value))}
          className={inputClass}
        />
      </label>
      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={message.error ? 'text-rose-500' : undefined}
        >
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <button
          type="submit"
          className={buttonClass}
          disabled={busy || !canSave}
        >
          {self.hasPin ? 'Change PIN' : 'Set PIN'}
        </button>
        {self.hasPin && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy || (needsOldPin && !isValidPin(oldPin))}
            onClick={() => void save(null)}
          >
            Remove PIN
          </button>
        )}
      </div>
    </form>
  )
}
