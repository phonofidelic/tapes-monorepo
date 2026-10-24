import { useEffect, useState } from 'react'
import {
  keyFingerprint,
  NO_SESSION_ID,
  type VerifiedPerson,
  type VerifiedSession,
} from '@tapes-monorepo/provenance'
import { useAppContext } from '@/context/AppContext'
import {
  useRecordingProvenance,
  type ProvenanceState,
} from '@/hooks/useRecordingProvenance'
import { readLocalDeviceKey } from '@/localDeviceKey'
import { readPersonKeyStatus } from '@/personKey'
import type { ProvenanceInput } from '@/recordingProvenance'

/**
 * One line on a Library row saying what a recording's signed statements prove,
 * with the details behind it.
 *
 * Every field shown comes from a statement that passed its checks, never from
 * the editable document. A device is named by a short key fingerprint, "this
 * device", or the label its person key certified. A person is named by key
 * fingerprint, or "you" for the person key on this device. A key is not a
 * person's name, and nothing here pretends it is.
 */

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function Clock({ iso }: { iso: string }) {
  const time = Date.parse(iso)
  return (
    <time dateTime={iso}>
      {Number.isNaN(time) ? iso : dateTime.format(time)}
    </time>
  )
}

function useLocalDeviceKey(): string | undefined {
  const appContext = useAppContext()
  const [key, setKey] = useState<string>()
  useEffect(() => {
    let current = true
    void readLocalDeviceKey(appContext).then((key) => current && setKey(key))
    return () => {
      current = false
    }
  }, [appContext])
  return key
}

function useLocalPersonKey(): string | undefined {
  const appContext = useAppContext()
  const [key, setKey] = useState<string>()
  useEffect(() => {
    let current = true
    readPersonKeyStatus(appContext).then(
      (status) =>
        current && setKey(status.exists ? status.publicKey : undefined),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [appContext])
  return key
}

function useFingerprint(key: string | undefined): string | undefined {
  const [held, setHeld] = useState<{ key: string; fingerprint?: string }>()
  useEffect(() => {
    if (!key) {
      return
    }
    let current = true
    void keyFingerprint(key).then(
      (fingerprint) => current && setHeld({ key, fingerprint }),
    )
    return () => {
      current = false
    }
  }, [key])
  return held && held.key === key ? held.fingerprint : undefined
}

function useDeviceName(
  deviceKey: string | undefined,
  localKey: string | undefined,
  certifiedLabel?: string,
): string {
  const fingerprint = useFingerprint(deviceKey)
  if (deviceKey && deviceKey === localKey) {
    return 'this device'
  }
  if (certifiedLabel) {
    return `“${certifiedLabel}”`
  }
  return fingerprint ? `device ${fingerprint}` : 'another device'
}

function usePersonName(
  person: VerifiedPerson | undefined,
  localPersonKey: string | undefined,
): string | undefined {
  const fingerprint = useFingerprint(person?.personKey)
  if (!person) {
    return undefined
  }
  if (person.personKey === localPersonKey) {
    return 'you'
  }
  return fingerprint ? `person ${fingerprint}` : 'another person'
}

function plural(count: number, word: string): string {
  return count === 1 ? `1 ${word}` : `${count} ${word}s`
}

export function ProvenanceSummary({
  recording,
}: {
  recording: ProvenanceInput
}) {
  return <ProvenanceText provenance={useRecordingProvenance(recording)} />
}

function ProvenanceText({ provenance }: { provenance: ProvenanceState }) {
  const localKey = useLocalDeviceKey()
  const localPersonKey = useLocalPersonKey()
  const person = 'person' in provenance ? provenance.person : undefined
  const deviceName = useDeviceName(
    'deviceKey' in provenance ? provenance.deviceKey : undefined,
    localKey,
    person?.deviceLabel,
  )
  const personName = usePersonName(person, localPersonKey)

  switch (provenance.state) {
    case 'checking':
      return <Line>Checking where this was recorded…</Line>
    case 'unverified':
      return (
        <Line>Not signed. There is no record of which device made it.</Line>
      )
    case 'unavailable':
      return (
        <Details summary="Can't check where this was recorded right now.">
          <p>
            No host could send {plural(provenance.missing.length, 'statement')}{' '}
            for this recording. The host may be offline, or the audio may have
            been copied without them.
          </p>
        </Details>
      )
    case 'failed':
      return (
        <Details summary="The signature check failed. This recording's record may have been changed.">
          <p>
            {plural(provenance.failures.length, 'signed statement')} listed for
            this recording did not pass.
          </p>
        </Details>
      )
    case 'device-only':
      return (
        <Details
          summary={
            personName
              ? `Signed by ${personName} on ${deviceName}. The host did not confirm when it arrived.`
              : `Signed on ${deviceName}. The host did not confirm when it arrived.`
          }
        >
          <DeviceTimes {...provenance} />
          {person && personName && <Person {...person} name={personName} />}
          <Session {...provenance} localKey={localKey} />
        </Details>
      )
    case 'verified':
      return (
        <Details
          summary={
            provenance.recordedByHost ? (
              <>Recorded by the host, on {deviceName}.</>
            ) : (
              <>
                Recorded {personName && <>by {personName} </>}on {deviceName},
                received by the host <Clock iso={provenance.receivedAt} />.
              </>
            )
          }
        >
          <DeviceTimes {...provenance} />
          {person && personName && <Person {...person} name={personName} />}
          <p>
            Received <Clock iso={provenance.receivedAt} />, by the host&apos;s
            clock.
          </p>
          {provenance.recordedByHost ? (
            <p>
              The host recorded this itself and signed its own receipt, so the
              receipt is not separate confirmation.
            </p>
          ) : (
            <p>Which host signed the receipt is not checked yet.</p>
          )}
          <Session {...provenance} localKey={localKey} />
        </Details>
      )
  }
}

function DeviceTimes({
  startedAt,
  endedAt,
}: {
  startedAt: string
  endedAt: string
}) {
  return (
    <p>
      Started <Clock iso={startedAt} /> and ended <Clock iso={endedAt} />, by
      the recording device&apos;s clock.
    </p>
  )
}

function Person({
  name,
  deviceLabel,
  issuedAt,
}: VerifiedPerson & { name: string }) {
  return (
    <p>
      {name === 'you' ? 'Your person key' : `The key of ${name}`} certified the
      recording device as “{deviceLabel}” on <Clock iso={issuedAt} />, by that
      device&apos;s clock.
    </p>
  )
}

function Session({
  sessionId,
  session,
  localKey,
}: {
  sessionId: string
  session?: VerifiedSession
  localKey: string | undefined
}) {
  if (sessionId === NO_SESSION_ID) {
    return null
  }
  if (!session) {
    return <p>Session {sessionId}.</p>
  }
  return (
    <>
      <p>
        Session {sessionId}, open from <Clock iso={session.openedAt} /> to{' '}
        <Clock iso={session.closedAt} />, by the host&apos;s clock.
      </p>
      {session.devices.length === 0 ? (
        <p>No device proved its key while connected.</p>
      ) : (
        <ul className="flex flex-col gap-1 pl-3">
          {session.devices.map((device) => (
            <SessionDevice
              key={device.deviceKey}
              {...device}
              localKey={localKey}
            />
          ))}
        </ul>
      )}
      <p>
        Which host signed the session record is not checked yet. Devices are
        shown by key, not by who owns them.
      </p>
    </>
  )
}

function SessionDevice({
  deviceKey,
  spans,
  localKey,
}: VerifiedSession['devices'][number] & { localKey: string | undefined }) {
  const name = useDeviceName(deviceKey, localKey)
  return (
    <li>
      Connected: {name}
      {spans.map((span) => (
        <span key={`${span.joinedAt} ${span.leftAt}`}>
          , joined <Clock iso={span.joinedAt} /> and left{' '}
          <Clock iso={span.leftAt} />
        </span>
      ))}
      .
    </li>
  )
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="p-1 text-xs text-zinc-400">{children}</p>
}

function Details({
  summary,
  children,
}: {
  summary: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <details className="p-1 text-xs text-zinc-400">
      <summary className="cursor-pointer">{summary}</summary>
      <div className="flex flex-col gap-1 pt-1 pl-3">{children}</div>
    </details>
  )
}
