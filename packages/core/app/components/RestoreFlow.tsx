import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { parseBackupText } from '@tapes-monorepo/provenance'
import { resolveDeviceLabel } from '@/deviceLabel'
import { restorePersonKey, type PersonKeyStatus } from '@/personKey'
import { decodeQr, decodeQrFromImage, frameData } from '@/qrDecode'
import { PromptFrame } from './PromptFrame'

/**
 * Brings a person key back onto this device from its passphrase backup. The
 * backup can come from the camera, a saved file, a photo of its QR code or
 * pasted text. Once it unlocks, the person key certifies this device and
 * replaces any vouch the host signed for it.
 */

/** How often the camera view is checked for a QR code. */
const SCAN_INTERVAL_MS = 250

type Step =
  { kind: 'find' } | { kind: 'scan' } | { kind: 'unlock'; text: string }

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

export function RestoreFlow({
  worker,
  onRestored,
  onCancel,
}: {
  worker: Worker
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

  return (
    <PromptFrame title="Restore your person key">
      {step.kind === 'find' && (
        <FindBackup
          onFound={found}
          onScan={() => {
            setError(undefined)
            setStep({ kind: 'scan' })
          }}
          onError={setError}
        />
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
  onError,
}: {
  onFound: (text: string) => void
  onScan: () => void
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
      <p>
        You need your backup and its passphrase. The backup is the file you
        saved or the QR code you kept.
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
      onError(
        result.problem === 'wrong-passphrase'
          ? 'That passphrase does not unlock the backup. Check each word.'
          : result.problem === 'other-person-key'
            ? 'This backup is for a different person than this phone is set up for.'
            : 'The backup could not be read.',
      )
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
