import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { parseBackupText } from '@tapes-monorepo/provenance'
import type { BlobEndpoint } from '@/blobClient'
import { resolveDeviceLabel } from '@/deviceLabel'
import { fetchPasskeyRecord } from '@/passkeyRecordClient'
import {
  restorePersonKey,
  restorePersonKeyWithPasskey,
  type PersonKeyStatus,
} from '@/personKey'
import { runPasskeyCeremony } from '@/personKeyCeremony'
import { decodeQr, decodeQrFromImage, frameData } from '@/qrDecode'
import { ceremonyProblems } from './PasskeyRecordSettings'
import { PromptFrame } from './PromptFrame'

/**
 * Brings a person key back onto this device, either way it was kept. A
 * passphrase backup can come from the camera, a saved file, a photo of its QR
 * code or pasted text. A passkey instead opens the copy the host holds.
 * Once it unlocks, the person key certifies this device and replaces any
 * vouch the host signed for it.
 */

/** How often the camera view is checked for a QR code. */
const SCAN_INTERVAL_MS = 250

type Step =
  | { kind: 'find' }
  | { kind: 'scan' }
  | { kind: 'passkey' }
  | { kind: 'unlock'; text: string }

/** Words for a backup that cannot be read, before any passphrase is asked. */
function readError(text: string): string | undefined {
  const parsed = parseBackupText(text)
  if (parsed.ok) {
    return undefined
  }
  if (parsed.problem === 'newer-version') {
    return 'This backup was made by a newer version of Tapes. Update Tapes and try again.'
  }
  return parsed.problem === 'not-a-backup'
    ? 'That is not a Tapes person key backup.'
    : 'The backup is damaged. Try another copy.'
}

/** Words for a copy that did not open, whichever way it was locked. */
function restoreError(
  problem:
    'unreadable' | 'wrong-passphrase' | 'wrong-passkey' | 'other-person-key',
): string {
  if (problem === 'wrong-passphrase') {
    return 'That passphrase does not unlock the backup. Check each word.'
  }
  if (problem === 'wrong-passkey') {
    return 'That passkey does not open the copy your host holds.'
  }
  return problem === 'other-person-key'
    ? 'This backup is for a different person than this phone is set up for.'
    : 'The backup could not be read.'
}

export function RestoreFlow({
  worker,
  endpoint,
  hostName,
  onRestored,
  onCancel,
}: {
  worker: Worker
  /** Where the host's records live. Without one, only a backup restores. */
  endpoint?: BlobEndpoint
  hostName: string
  onRestored: (status: PersonKeyStatus) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>({ kind: 'find' })
  const [error, setError] = useState<string>()

  const found = (text: string) => {
    const problem = readError(text)
    setError(problem)
    setStep(problem ? { kind: 'find' } : { kind: 'unlock', text: text.trim() })
  }

  const giveUp = (message: string) => {
    setError(message)
    setStep({ kind: 'find' })
  }

  // The tab has to open inside the click, so the ceremony runs before any
  // await and the rest follows it.
  const restoreWithPasskey = () => {
    if (!endpoint) {
      return
    }
    setError(undefined)
    setStep({ kind: 'passkey' })
    runPasskeyCeremony({ action: 'get', hostName }, {}).then(
      async (outcome) => {
        if (!outcome.ok) {
          giveUp(ceremonyProblems[outcome.problem])
          return
        }
        try {
          const held = await fetchPasskeyRecord(endpoint, outcome)
          if (!held.ok) {
            giveUp(
              held.problem === 'unreachable'
                ? `${hostName} could not be reached. Use your backup instead.`
                : `${hostName} holds no copy for that passkey. Use your backup instead.`,
            )
            return
          }
          const result = await restorePersonKeyWithPasskey(
            worker,
            held.record,
            outcome.prf,
            resolveDeviceLabel({ storage: localStorage, navigator }),
          )
          if (result.ok) {
            onRestored(result.status)
            return
          }
          giveUp(restoreError(result.problem))
        } catch (cause) {
          console.error('Could not restore with the passkey:', cause)
          giveUp('Restoring failed. Try again.')
        } finally {
          outcome.prf.fill(0)
        }
      },
      (cause: unknown) => {
        console.warn('The passkey restore failed:', cause)
        giveUp(ceremonyProblems.failed)
      },
    )
  }

  return (
    <PromptFrame title="Restore your person key">
      {step.kind === 'find' && (
        <FindBackup
          onFound={found}
          onScan={() => {
            setError(undefined)
            setStep({ kind: 'scan' })
          }}
          onPasskey={endpoint ? restoreWithPasskey : undefined}
          hostName={hostName}
          onError={setError}
        />
      )}
      {step.kind === 'passkey' && (
        <p role="status">Follow the prompt in the passkey tab.</p>
      )}
      {step.kind === 'scan' && (
        <ScanBackup
          onFound={found}
          onFail={(message) => {
            setError(message)
            setStep({ kind: 'find' })
          }}
        />
      )}
      {step.kind === 'unlock' && (
        <UnlockBackup
          worker={worker}
          text={step.text}
          onRestored={onRestored}
          onError={setError}
        />
      )}
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </PromptFrame>
  )
}

function FindBackup({
  onFound,
  onScan,
  onPasskey,
  hostName,
  onError,
}: {
  onFound: (text: string) => void
  onScan: () => void
  /** Left out where the host that holds the records is not reachable. */
  onPasskey?: () => void
  hostName: string
  onError: (message: string) => void
}) {
  const [pasted, setPasted] = useState('')

  const readFile = async (file: File) => {
    try {
      if (file.type.startsWith('image/')) {
        const text = await decodeQrFromImage(file)
        if (text) {
          onFound(text)
        } else {
          onError('No QR code could be read in that photo. Try a sharper one.')
        }
        return
      }
      onFound(await file.text())
    } catch (cause) {
      console.error('Could not read the backup file:', cause)
      onError('That file could not be read.')
    }
  }

  return (
    <>
      {onPasskey && (
        <>
          <p>
            Your passkey opens the copy {hostName} holds. It is the quickest way
            back on a new phone.
          </p>
          <button
            className="rounded-md bg-zinc-50 px-3 py-2 text-left font-medium text-zinc-900 hover:bg-zinc-200"
            onClick={onPasskey}
          >
            Use your passkey
          </button>
        </>
      )}
      <p>
        {onPasskey ? 'Or use your backup' : 'You need your backup'} and its
        passphrase. The backup is the file you saved or the QR code you kept.
      </p>
      <button
        className="rounded-md bg-zinc-800 px-3 py-2 text-left hover:bg-zinc-700"
        onClick={onScan}
      >
        Scan the QR code with the camera
      </button>
      <label className="flex cursor-pointer flex-col gap-1 rounded-md bg-zinc-800 px-3 py-2 hover:bg-zinc-700">
        Choose the backup file or a photo of the QR code
        <input
          type="file"
          accept="image/*,text/plain,.txt,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              void readFile(file)
            }
          }}
        />
      </label>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onFound(pasted)
        }}
      >
        <label className="flex flex-col gap-1">
          Or paste the backup text
          <textarea
            rows={3}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            className="rounded-md bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-50"
          />
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
            disabled={pasted.trim() === ''}
          >
            Continue
          </button>
        </div>
      </form>
    </>
  )
}

function ScanBackup({
  onFound,
  onFail,
}: {
  onFound: (text: string) => void
  onFail: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Effect events, so a parent's new callbacks do not restart the camera.
  const found = useEffectEvent(onFound)
  const fail = useEffectEvent(onFail)

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let stopped = false

    const stop = () => {
      stopped = true
      clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (media) => {
        stream = media
        if (stopped || !videoRef.current) {
          stop()
          return
        }
        videoRef.current.srcObject = media
        await videoRef.current.play()
        timer = setInterval(() => {
          const element = videoRef.current
          if (!element || element.videoWidth === 0) {
            return
          }
          const data = frameData(
            element,
            element.videoWidth,
            element.videoHeight,
          )
          const text = data && decodeQr(data)
          if (text) {
            stop()
            found(text)
          }
        }, SCAN_INTERVAL_MS)
      })
      .catch((cause: unknown) => {
        console.warn('No camera for scanning the backup:', cause)
        if (!stopped) {
          fail(
            'The camera could not be opened. Choose a photo or the file instead.',
          )
        }
      })
    return stop
  }, [])

  return (
    <>
      <p>Point the camera at the backup&apos;s QR code.</p>
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Camera view"
        className="w-full rounded-md bg-black"
      />
    </>
  )
}

function UnlockBackup({
  worker,
  text,
  onRestored,
  onError,
}: {
  worker: Worker
  text: string
  onRestored: (status: PersonKeyStatus) => void
  onError: (message: string | undefined) => void
}) {
  const [passphrase, setPassphrase] = useState('')
  const [restoring, setRestoring] = useState(false)

  const restore = async () => {
    setRestoring(true)
    onError(undefined)
    try {
      const result = await restorePersonKey(
        worker,
        text,
        passphrase,
        resolveDeviceLabel({ storage: localStorage, navigator }),
      )
      if (result.ok) {
        onRestored(result.status)
        return
      }
      onError(restoreError(result.problem))
    } catch (cause) {
      console.error('Could not restore the person key:', cause)
      onError('Restoring failed. Try again.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void restore()
      }}
    >
      <p>Found your backup.</p>
      <label className="flex flex-col gap-1">
        Your passphrase
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
      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          disabled={restoring || passphrase.trim() === ''}
        >
          {restoring ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    </form>
  )
}
