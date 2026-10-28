import { useEffect, useState } from 'react'
import { isValidPin, type RosterPerson } from '@tapes-monorepo/sync-protocol'
import { Button } from '@tapes-monorepo/ui'
import type {
  IpcResponse,
  IpcService,
  SignedVouch,
  SignedVouchesResponse,
} from '@/IpcService'
import { useAppContext } from '@/context/AppContext'
import { useAutomergeUrl } from '@/utils'

/**
 * On the host, the people on its roster and their PINs. After too many wrong
 * PINs a person is locked out of the PIN path. The operator checks who is
 * asking, then unlocks it, or lets the person type a new PIN here.
 *
 * Each person also lists the devices this host has vouched for. The operator
 * can withdraw a vouch given to the wrong person, which the host signs and
 * lists on the recordings that name it.
 *
 * Read when Settings opens. A lockout that happens while it is open shows
 * after the next action or visit.
 */
export function RosterSettings() {
  const appContext = useAppContext()
  const ipc = appContext.type === 'electron-client' ? appContext.ipc : undefined
  const { automergeUrl } = useAutomergeUrl()
  const [people, setPeople] = useState<RosterPerson[]>()
  const [vouches, setVouches] = useState<SignedVouch[]>([])
  // Bumped after each change to read the roster again.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!ipc) {
      return
    }
    let current = true
    ipc.send<IpcResponse | undefined>('roster:get-people').then(
      (response) => {
        if (current && response?.success) {
          const data = (response.data ?? {}) as { people?: RosterPerson[] }
          setPeople(data.people ?? [])
        }
      },
      (error: unknown) => console.warn('Could not read the roster:', error),
    )
    ipc.send<SignedVouchesResponse | undefined>('roster:get-vouches').then(
      (response) => {
        if (current && response?.success) {
          setVouches(response.data.vouches)
        }
      },
      (error: unknown) =>
        console.warn('Could not read the signed vouches:', error),
    )
    return () => {
      current = false
    }
  }, [ipc, version])

  if (!ipc || !people || people.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      <h2>People</h2>
      <ul className="flex flex-col gap-3 pl-2 text-sm">
        {people.map((person) => (
          <PersonRow
            key={person.personKey}
            ipc={ipc}
            person={person}
            vouches={vouches.filter(
              (vouch) => vouch.personKey === person.personKey,
            )}
            docUrl={automergeUrl}
            onChanged={() => setVersion((each) => each + 1)}
          />
        ))}
      </ul>
    </div>
  )
}

function PersonRow({
  ipc,
  person,
  vouches,
  docUrl,
  onChanged,
}: {
  ipc: IpcService
  person: RosterPerson
  vouches: SignedVouch[]
  /** The root document whose recordings a revocation is listed on. */
  docUrl: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [settingPin, setSettingPin] = useState(false)
  const [pin, setPin] = useState('')

  const run = async (send: () => Promise<IpcResponse | undefined>) => {
    setBusy(true)
    setError(undefined)
    try {
      const response = await send()
      if (!response?.success) {
        setError('That did not go through. Try again.')
        return
      }
      setSettingPin(false)
      setPin('')
      onChanged()
    } catch (cause) {
      console.error('Could not change this person on the roster:', cause)
      setError('That did not go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const unlock = () =>
    run(() =>
      ipc.send<IpcResponse | undefined>('roster:unlock-pin', {
        data: { personKey: person.personKey },
      }),
    )
  const savePin = (next: string | null) =>
    run(() =>
      ipc.send<IpcResponse | undefined>('roster:set-pin', {
        data: { personKey: person.personKey, pin: next },
      }),
    )
  const revoke = (address: string) =>
    run(() =>
      ipc.send<IpcResponse | undefined>('roster:revoke-vouch', {
        data: { address, docUrl: docUrl ?? '' },
      }),
    )

  return (
    <li className="flex flex-col gap-1">
      <p>
        <span className="font-medium">{person.name}</span>
        <span className="block text-xs text-zinc-500">
          {person.pinLocked
            ? 'PIN locked after too many wrong tries'
            : person.hasPin
              ? 'Has a PIN'
              : 'No PIN'}
        </span>
      </p>
      {error && (
        <p role="alert" className="text-rose-500">
          {error}
        </p>
      )}
      {settingPin ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (isValidPin(pin)) {
              void savePin(pin)
            }
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs">
              {person.name} types a new PIN, 4 to 6 digits
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, ''))
              }
              className="rounded-sm bg-transparent p-2 ring-1 ring-zinc-400"
            />
          </label>
          {/* Plain buttons, because the shared one cannot take a type. */}
          <button
            type="submit"
            className="w-fit rounded-sm p-2 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
            disabled={busy || !isValidPin(pin)}
          >
            Save PIN
          </button>
          <button
            type="button"
            className="w-fit rounded-sm p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              setSettingPin(false)
              setPin('')
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1">
          {person.pinLocked && (
            <Button
              className="w-fit p-2"
              disabled={busy}
              onClick={() => void unlock()}
            >
              Unlock PIN
            </Button>
          )}
          <Button
            className="w-fit p-2"
            disabled={busy}
            onClick={() => setSettingPin(true)}
          >
            {person.hasPin ? 'Change PIN' : 'Set a PIN'}
          </Button>
          {person.hasPin && (
            <Button
              className="w-fit p-2"
              disabled={busy}
              onClick={() => void savePin(null)}
            >
              Remove PIN
            </Button>
          )}
        </div>
      )}
      {vouches.length > 0 && (
        <VouchedDevices
          vouches={vouches}
          // Without a root document there are no recordings to list the
          // revocation on, so the host would sign one no reader would see.
          canRevoke={docUrl !== null && !busy}
          onRevoke={revoke}
        />
      )}
    </li>
  )
}

/**
 * The devices this host vouched for as one person. A vouch is kept after it is
 * withdrawn, so the operator can see that it was.
 */
function VouchedDevices({
  vouches,
  canRevoke,
  onRevoke,
}: {
  vouches: SignedVouch[]
  canRevoke: boolean
  onRevoke: (address: string) => Promise<void>
}) {
  return (
    <ul className="flex flex-col gap-2 pl-2 text-xs">
      {vouches.map((vouch) => (
        <li key={vouch.address} className="flex flex-col gap-1">
          <span>
            Vouched for “{vouch.deviceLabel}”
            {vouch.method === 'pin' ? ', by PIN' : ', in person'}, key{' '}
            {vouch.deviceFingerprint}
          </span>
          {vouch.revokedAt ? (
            <span className="text-zinc-500">Withdrawn</span>
          ) : (
            <Button
              className="w-fit p-1"
              disabled={!canRevoke}
              onClick={() => void onRevoke(vouch.address)}
            >
              Withdraw this vouch
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
