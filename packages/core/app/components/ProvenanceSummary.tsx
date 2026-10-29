import { useEffect, useState } from 'react'
import { Button } from '@tapes-monorepo/ui'
import {
  keyFingerprint,
  NO_SESSION_ID,
  type RevocationReason,
  type RevokedDeviceLink,
  type VerifiedPerson,
  type VerifiedSession,
} from '@tapes-monorepo/provenance'
import { useAppContext } from '@/context/AppContext'
import {
  useRecordingProvenance,
  type ProvenanceState,
} from '@/hooks/useRecordingProvenance'
import { useTrustedHosts } from '@/hooks/useTrustedHosts'
import { readLocalDeviceKey } from '@/localDeviceKey'
import { readPersonKeyStatus } from '@/personKey'
import type { ProvenanceInput } from '@/recordingProvenance'
import { trustHost } from '@/trustedHosts'

/**
 * One line on a Library row saying what a recording's signed statements prove,
 * with the details behind it.
 *
 * Every field shown comes from a statement that passed its checks, never from
 * the editable document. A device is named by a short key fingerprint, "this
 * device", or the label its person key certified. A person is named by key
 * fingerprint, or "you" for the person key on this device. A key is not a
 * person's name, and nothing here pretends it is. A host's vouch is the one
 * exception: it shows the host's name for the person, along with the host that
 * signed it.
 *
 * A vouch from a host the operator trusts counts as the person's own, so the
 * host is left off the name. Whom to trust is this reader's decision, kept per
 * device by `trustedHosts.ts`. The operator starts trusting a host from the
 * vouch shown here and stops in Settings.
 *
 * A device key whose certificate or vouch was revoked is still shown. The line
 * between takes to keep and takes to doubt is whether a host had the recording
 * before trust in the device ended.
 */

/** Signs a revocation for a device this person's key stands behind. */
type RevokeDevice = (device: {
  deviceKey: string
  deviceLink: string
  reason: RevocationReason
}) => Promise<void>

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
  trustedHost: boolean,
): string | undefined {
  const fingerprint = useFingerprint(person?.personKey)
  if (!person) {
    return undefined
  }
  const name =
    person.personKey === localPersonKey
      ? 'you'
      : person.via === 'vouch'
        ? person.personName
        : fingerprint
          ? `person ${fingerprint}`
          : 'another person'
  // The person key signed nothing, so the name is only as good as the host.
  // Which host that was is the point of saying it, unless the reader has
  // already said they trust that host.
  return person.via === 'vouch' && !trustedHost
    ? `${name}, vouched by ${person.hostLabel}`
    : name
}

function plural(count: number, word: string): string {
  return count === 1 ? `1 ${word}` : `${count} ${word}s`
}

export function ProvenanceSummary({
  recording,
  onRevokeDevice,
}: {
  recording: ProvenanceInput
  /**
   * Offered only when this device holds the person key the recording names.
   * Left out, the details are read-only.
   */
  onRevokeDevice?: RevokeDevice
}) {
  return (
    <ProvenanceText
      provenance={useRecordingProvenance(recording)}
      onRevokeDevice={onRevokeDevice}
    />
  )
}

function ProvenanceText({
  provenance,
  onRevokeDevice,
}: {
  provenance: ProvenanceState
  onRevokeDevice?: RevokeDevice
}) {
  const appContext = useAppContext()
  const localKey = useLocalDeviceKey()
  const localPersonKey = useLocalPersonKey()
  const trustedHosts = useTrustedHosts()
  const person = 'person' in provenance ? provenance.person : undefined
  const deviceName = useDeviceName(
    'deviceKey' in provenance ? provenance.deviceKey : undefined,
    localKey,
    person?.deviceLabel,
  )
  // Only a vouch leans on a host. A certificate the person key signed itself
  // needs no trust from the reader, and a vouch the person has since replaced
  // with one is not what a claim names any more.
  const vouch = person?.via === 'vouch' ? person : undefined
  const trustedHost = trustedHosts.some(
    (host) => host.hostKey === vouch?.hostKey,
  )
  const personName = usePersonName(person, localPersonKey, trustedHost)
  const revocation =
    'revocation' in provenance ? provenance.revocation : undefined
  const deviceLink =
    'deviceLink' in provenance ? provenance.deviceLink : undefined
  const deviceKey = 'deviceKey' in provenance ? provenance.deviceKey : undefined
  // Only the person key behind the statement can withdraw it, and revoking
  // the device you are using would cast doubt on its next take.
  const revocable =
    onRevokeDevice !== undefined &&
    revocation === undefined &&
    person !== undefined &&
    person.personKey === localPersonKey &&
    deviceLink !== undefined &&
    deviceKey !== undefined &&
    deviceKey !== localKey
  // The host the operator could start trusting. Trusting one is the host
  // operator's call: a guest reads vouches but does not decide which count.
  const trustableHost =
    appContext.type === 'electron-client' && !trustedHost ? vouch : undefined

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
            <>
              {personName
                ? `Signed by ${personName} on ${deviceName}. The host did not confirm when it arrived.`
                : `Signed on ${deviceName}. The host did not confirm when it arrived.`}
              {revocation && <RevocationFlag {...revocation} />}
            </>
          }
        >
          <DeviceTimes {...provenance} />
          {person && personName && (
            <Person {...person} name={personName} trustedHost={trustedHost} />
          )}
          {trustableHost && (
            <TrustHostControls
              hostKey={trustableHost.hostKey}
              hostLabel={trustableHost.hostLabel}
            />
          )}
          {revocation && <Revocation {...revocation} />}
          {revocable && (
            <RevokeDeviceControls
              deviceName={deviceName}
              onRevoke={(reason) =>
                onRevokeDevice({ deviceKey, deviceLink, reason })
              }
            />
          )}
          <Session {...provenance} localKey={localKey} />
        </Details>
      )
    case 'verified':
      return (
        <Details
          summary={
            <>
              {provenance.recordedByHost ? (
                <>Recorded by the host, on {deviceName}.</>
              ) : (
                <>
                  Recorded {personName && <>by {personName} </>}on {deviceName},
                  received by the host <Clock iso={provenance.receivedAt} />.
                </>
              )}
              {revocation && <RevocationFlag {...revocation} />}
            </>
          }
        >
          <DeviceTimes {...provenance} />
          {person && personName && (
            <Person {...person} name={personName} trustedHost={trustedHost} />
          )}
          {trustableHost && (
            <TrustHostControls
              hostKey={trustableHost.hostKey}
              hostLabel={trustableHost.hostLabel}
            />
          )}
          {revocation && <Revocation {...revocation} />}
          {revocable && (
            <RevokeDeviceControls
              deviceName={deviceName}
              onRevoke={(reason) =>
                onRevokeDevice({ deviceKey, deviceLink, reason })
              }
            />
          )}
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

/** The word for a reason, as the signer meant it. */
const REVOCATION_REASONS: Record<RevocationReason, string> = {
  lost: 'as lost or stolen',
  retired: 'as no longer in use',
  'wrong-person': 'as vouched for the wrong person',
}

/** The short warning on the summary line, where the take is in doubt. */
function RevocationFlag({ receivedBeforeRevocation }: RevokedDeviceLink) {
  return receivedBeforeRevocation ? (
    <> The device key was revoked later.</>
  ) : (
    <> The device key was revoked before this arrived.</>
  )
}

function Revocation({
  signedBy,
  reason,
  revokedAt,
  receivedBeforeRevocation,
}: RevokedDeviceLink) {
  const who =
    signedBy === 'person'
      ? 'The person key behind the recording device'
      : 'The host that vouched for the recording device'
  return (
    <p>
      {who} marked it {REVOCATION_REASONS[reason]} on <Clock iso={revokedAt} />,
      by the signer&apos;s clock.{' '}
      {receivedBeforeRevocation
        ? 'A host already had this recording by then, so it stands.'
        : 'No host had this recording before that, so who made it is in doubt.'}
    </p>
  )
}

/**
 * Withdraws trust in the device a recording names. The lost device's own clock
 * is no help, so the reason is all the person has to say.
 */
function RevokeDeviceControls({
  deviceName,
  onRevoke,
}: {
  deviceName: string
  onRevoke: (reason: RevocationReason) => Promise<void>
}) {
  const [state, setState] = useState<'ready' | 'signing' | 'failed'>('ready')

  const revoke = (reason: RevocationReason) => {
    setState('signing')
    onRevoke(reason).then(
      () => setState('ready'),
      (error: unknown) => {
        console.warn('Could not revoke the device key:', error)
        setState('failed')
      },
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <p>Stop trusting {deviceName} for recordings from now on:</p>
      <div className="flex gap-1">
        <Button
          className="w-fit p-1"
          disabled={state === 'signing'}
          onClick={() => revoke('lost')}
        >
          Lost or stolen
        </Button>
        <Button
          className="w-fit p-1"
          disabled={state === 'signing'}
          onClick={() => revoke('retired')}
        >
          No longer in use
        </Button>
      </div>
      {state === 'failed' && <p>That did not go through. Try again.</p>}
    </div>
  )
}

/**
 * Starts counting a host's vouches as the person's own signature. It applies
 * to every vouch that host signed, not just this one, so the operator stops
 * trusting it in Settings rather than from a single recording.
 */
function TrustHostControls({
  hostKey,
  hostLabel,
}: {
  hostKey: string
  hostLabel: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <p>Count what “{hostLabel}” vouches for as the person&apos;s own:</p>
      <Button
        className="w-fit p-1"
        onClick={() => trustHost({ hostKey, hostLabel })}
      >
        Trust this host
      </Button>
    </div>
  )
}

function Person({
  name,
  trustedHost,
  ...person
}: VerifiedPerson & { name: string; trustedHost: boolean }) {
  if (person.via === 'vouch') {
    const confirmed =
      person.method === 'pin' ? 'who entered their PIN' : 'confirmed in person'
    return (
      <p>
        The host “{person.hostLabel}” vouched for the recording device “
        {person.deviceLabel}” as {person.personName}, {confirmed}, on{' '}
        <Clock iso={person.vouchedAt} />, by the host&apos;s clock.{' '}
        {trustedHost && (
          <>You trust that host, so this counts as {person.personName}. </>
        )}
        The person&apos;s own key has not certified this device.
      </p>
    )
  }
  return (
    <p>
      {name === 'you' ? 'Your person key' : `The key of ${name}`} certified the
      recording device as “{person.deviceLabel}” on{' '}
      <Clock iso={person.issuedAt} />, by that device&apos;s clock.
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
