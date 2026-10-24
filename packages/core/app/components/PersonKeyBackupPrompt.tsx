import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { normalizePassphrase } from '@tapes-monorepo/provenance'
import { isValidPin, sanitizeLabel } from '@tapes-monorepo/sync-protocol'
import type { BlobEndpoint } from '@/blobClient'
import { useAppContext } from '@/context/AppContext'
import { useUploadEndpoint } from '@/context/BlobContext'
import { useSetting } from '@/context/SettingsContext'
import { MAX_LABEL_LENGTH } from '@/deviceLabel'
import { usePersonKey } from '@/hooks/usePersonKey'
import {
  backUpPersonKey,
  checkPersonKeyBackup,
  generatePassphrase,
} from '@/personKey'
import { joinHostRoster } from '@/rosterClient'

/**
 * Walks a guest through its first join, right after its person key is made.
 * First the person gives the host their name and an optional PIN, so the host
 * can vouch for a new device of theirs later. Then they back up the person key:
 * lock it with a passphrase, save it as a file or a QR code, and type the
 * passphrase again. That check unlocks the saved backup for real.
 *
 * Each step stops appearing once done. "Not now" hides the prompt until the
 * next page load.
 */

const BACKUP_FILE_NAME = 'tapes-person-key-backup.txt'

/** A chosen passphrase is attacked offline, so it needs some length. */
export const MIN_CHOSEN_PASSPHRASE_LENGTH = 16

type Step =
  | { kind: 'choose' }
  | { kind: 'locking' }
  | { kind: 'save'; text: string; fileText: string; showQr: boolean }
  | { kind: 'check'; text: string; fileText: string }
  | { kind: 'done' }

export function PersonKeyBackupPrompt() {
  const appContext = useAppContext()
  const { status, update } = usePersonKey()
  const endpoint = useUploadEndpoint()
  const [dismissed, setDismissed] = useState(false)

  if (appContext.type !== 'web-client' || !status?.exists || dismissed) {
    return null
  }
  // Joining needs a host to join. A standalone web client skips it.
  if (!status.joinedAt && endpoint) {
    return (
      <JoinFlow
        worker={appContext.worker}
        endpoint={endpoint}
        onLater={() => setDismissed(true)}
        onJoined={(joinedAt) => update({ ...status, joinedAt })}
      />
    )
  }
  if (status.backedUpAt) {
    return null
  }
  return (
    <BackupFlow
      worker={appContext.worker}
      onLater={() => setDismissed(true)}
      onBackedUp={(backedUpAt) => update({ ...status, backedUpAt })}
    />
  )
}

export function BackupFlow({
  worker,
  onLater,
  onBackedUp,
}: {
  worker: Worker
  onLater: () => void
  onBackedUp: (backedUpAt: string) => void
}) {
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [error, setError] = useState<string>()

  const lock = async (passphrase: string) => {
    setError(undefined)
    setStep({ kind: 'locking' })
    try {
      const backup = await backUpPersonKey(worker, passphrase)
      setStep({ kind: 'save', ...backup, showQr: false })
    } catch (cause) {
      console.error('Could not back up the person key:', cause)
      setError('The backup could not be made. Try again.')
      setStep({ kind: 'choose' })
    }
  }

  const check = async (text: string, passphrase: string) => {
    setError(undefined)
    try {
      const result = await checkPersonKeyBackup(worker, text, passphrase)
      if (result.ok) {
        setStep({ kind: 'done' })
        onBackedUp(result.backedUpAt)
        return
      }
      setError(
        result.problem === 'wrong-passphrase'
          ? 'That passphrase does not unlock the backup. Check each word.'
          : 'The backup does not match this device. Make it again.',
      )
    } catch (cause) {
      console.error('Could not check the backup:', cause)
      setError('The backup could not be checked. Try again.')
    }
  }

  return (
    <PromptFrame title="Back up your person key">
      {step.kind === 'choose' && (
        <ChoosePassphrase worker={worker} onLock={lock} onLater={onLater} />
      )}
      {step.kind === 'locking' && <p>Locking the backup…</p>}
      {step.kind === 'save' && (
        <SaveBackup
          {...step}
          onToggleQr={() => setStep({ ...step, showQr: !step.showQr })}
          onSaved={() =>
            setStep({ kind: 'check', text: step.text, fileText: step.fileText })
          }
          onLater={onLater}
        />
      )}
      {step.kind === 'check' && (
        <CheckBackup
          onCheck={(passphrase) => check(step.text, passphrase)}
          onBack={() =>
            setStep({
              kind: 'save',
              text: step.text,
              fileText: step.fileText,
              showQr: false,
            })
          }
        />
      )}
      {step.kind === 'done' && <p>Backed up.</p>}
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
    </PromptFrame>
  )
}

function PromptFrame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      role="dialog"
      aria-labelledby="person-key-prompt-title"
      className="fixed inset-x-0 bottom-0 z-50 m-4 flex max-h-[90vh] flex-col gap-3 overflow-y-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-50 shadow-lg md:left-auto md:w-96"
    >
      <h2 id="person-key-prompt-title" className="font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Why a join failed, in words for the person joining. */
function joinError(problem: 'unreachable' | 'refused'): string {
  return problem === 'unreachable'
    ? 'The host did not answer. Check you are on its network and try again.'
    : 'The host did not accept that. Check your name and PIN and try again.'
}

export function JoinFlow({
  worker,
  endpoint,
  onLater,
  onJoined,
}: {
  worker: Worker
  endpoint: BlobEndpoint
  onLater: () => void
  onJoined: (joinedAt: string) => void
}) {
  const [personName, setPersonName] = useSetting('personName')
  const [name, setName] = useState(personName ?? '')
  const [pin, setPin] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string>()

  const cleanName = sanitizeLabel(name)
  // An empty PIN means none. Anything else must be a whole PIN.
  const pinProblem = pin !== '' && !isValidPin(pin)

  const join = async () => {
    if (!cleanName || pinProblem) {
      return
    }
    setError(undefined)
    setJoining(true)
    setPersonName(cleanName)
    try {
      const result = await joinHostRoster(worker, endpoint, {
        personName: cleanName,
        ...(pin !== '' && { pin }),
      })
      if (result.ok) {
        onJoined(result.joinedAt)
        return
      }
      setError(joinError(result.problem))
    } catch (cause) {
      console.error('Could not join the host:', cause)
      setError('Joining failed. Try again.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <PromptFrame title="Tell the host who you are">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void join()
        }}
      >
        <p>
          If this phone loses its keys, the host can vouch for your next one. It
          needs your name, and a PIN if you want to skip asking the host in
          person.
        </p>
        <label className="flex flex-col gap-1">
          Your name
          <input
            type="text"
            autoComplete="name"
            value={name}
            maxLength={MAX_LABEL_LENGTH}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md bg-zinc-800 px-2 py-1.5 text-zinc-50"
          />
        </label>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            PIN (optional)
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              aria-describedby="join-pin-hint"
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, ''))
              }
              className="rounded-md bg-zinc-800 px-2 py-1.5 text-zinc-50"
            />
          </label>
          <span id="join-pin-hint" className="text-xs text-zinc-400">
            4 to 6 digits. Leave it empty to ask the host in person instead.
          </span>
        </div>
        {error && (
          <p role="alert" className="text-rose-300">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
            onClick={onLater}
          >
            Not now
          </button>
          <button
            type="submit"
            className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
            disabled={joining || !cleanName || pinProblem}
          >
            {joining ? 'Joining…' : 'Join'}
          </button>
        </div>
      </form>
    </PromptFrame>
  )
}

function ChoosePassphrase({
  worker,
  onLock,
  onLater,
}: {
  worker: Worker
  onLock: (passphrase: string) => void
  onLater: () => void
}) {
  const [generated, setGenerated] = useState<string>()
  const [ownChoice, setOwnChoice] = useState<string>()

  useEffect(() => {
    let current = true
    generatePassphrase(worker).then(
      (passphrase) => current && setGenerated(passphrase),
      (error: unknown) => {
        console.error('Could not generate a passphrase:', error)
        if (current) {
          setOwnChoice('')
        }
      },
    )
    return () => {
      current = false
    }
  }, [worker])

  const choosing = ownChoice !== undefined
  const tooShort =
    choosing &&
    normalizePassphrase(ownChoice).length < MIN_CHOSEN_PASSPHRASE_LENGTH

  return (
    <>
      <p>
        Tapes made a person key on this device. It signs which of your devices
        recorded each take. Lock it with a passphrase and save the backup, so
        you can get it back on a new phone.
      </p>
      {choosing ? (
        <label className="flex flex-col gap-1">
          Your passphrase
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={ownChoice}
            onChange={(event) => setOwnChoice(event.target.value)}
            className="rounded-md bg-zinc-800 px-2 py-1.5 text-zinc-50"
          />
          <span className="text-xs text-zinc-400">
            At least {MIN_CHOSEN_PASSPHRASE_LENGTH} characters. Several unusual
            words are best.
          </span>
        </label>
      ) : (
        <>
          <p>Your passphrase. Write it down somewhere safe:</p>
          <p
            data-testid="generated-passphrase"
            className="rounded-md bg-zinc-800 px-2 py-1.5 font-mono text-base"
          >
            {generated ?? '…'}
          </p>
        </>
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
          onClick={() => setOwnChoice(choosing ? undefined : '')}
        >
          {choosing ? 'Use the generated one' : 'Choose my own'}
        </button>
        <button
          className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          disabled={choosing ? tooShort : !generated}
          onClick={() => onLock(choosing ? ownChoice : generated!)}
        >
          Lock backup
        </button>
      </div>
    </>
  )
}

function SaveBackup({
  text,
  fileText,
  showQr,
  onToggleQr,
  onSaved,
  onLater,
}: {
  text: string
  fileText: string
  showQr: boolean
  onToggleQr: () => void
  onSaved: () => void
  onLater: () => void
}) {
  return (
    <>
      <p>
        Save the backup somewhere other than this device. You need both the
        backup and the passphrase to restore it.
      </p>
      {showQr && (
        <div className="self-center rounded-md bg-white p-3">
          <QRCodeSVG value={text} level="M" title="Person key backup" />
        </div>
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
          onClick={onToggleQr}
        >
          {showQr ? 'Hide QR code' : 'Show QR code'}
        </button>
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={() => void saveBackupFile(fileText)}
        >
          Save file
        </button>
        <button
          className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200"
          onClick={onSaved}
        >
          I saved it
        </button>
      </div>
    </>
  )
}

function CheckBackup({
  onCheck,
  onBack,
}: {
  onCheck: (passphrase: string) => Promise<void>
  onBack: () => void
}) {
  const [passphrase, setPassphrase] = useState('')
  const [checking, setChecking] = useState(false)

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setChecking(true)
        void onCheck(passphrase).finally(() => setChecking(false))
      }}
    >
      <label className="flex flex-col gap-1">
        Type the passphrase again to check the backup opens
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="rounded-md bg-zinc-800 px-2 py-1.5 text-zinc-50"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="submit"
          className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          disabled={checking || passphrase.trim() === ''}
        >
          {checking ? 'Checking…' : 'Check'}
        </button>
      </div>
    </form>
  )
}

/**
 * Offers the file to the share sheet where the browser can share files, and
 * downloads it otherwise. Chrome's Web Share refuses `.json`, hence `.txt`.
 */
export async function saveBackupFile(fileText: string): Promise<void> {
  const file = new File([fileText], BACKUP_FILE_NAME, { type: 'text/plain' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Tapes person key backup' })
      return
    } catch (error) {
      // The person closed the sheet. They can press the button again.
      if ((error as Error | null)?.name === 'AbortError') {
        return
      }
      console.warn('Share failed, downloading the backup instead:', error)
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = BACKUP_FILE_NAME
  link.click()
  // Safari starts the download after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
