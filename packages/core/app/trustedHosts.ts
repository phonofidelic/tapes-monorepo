import type { VerifiedPerson } from '@tapes-monorepo/provenance'
import type { AppContextValue } from '@/context/AppContext'
import type { IpcResponse, TrustedHost } from '@/IpcService'

/**
 * Whose vouches this reader counts as the person's own signature.
 *
 * A vouch is a host's witness statement, not the person's signature, so
 * counting it is the reader's decision. Only the desktop host keeps a list:
 * it is the operator's, and it lives in the main process next to the roster.
 * A web guest has no list and counts no other host's vouch.
 *
 * The list is read once and shared, because every Library row asks. Changing
 * it tells the readers, so rows renaming a vouched person update together.
 */

/** The device a person key has certified, as this device can see it. */
export type CertifiedDevice = { personKey: string; deviceKey: string }

/** Why a vouch counts, for the Library to explain. */
export type VouchCredit =
  | { counts: false }
  /**
   * `trusted-host` when the operator trusts the signing host's key.
   * `certified-device` when the person's own key has since certified the
   * device the host vouched for, which settles it without trusting the host.
   */
  | { counts: true; because: 'trusted-host' | 'certified-device' }

/** A vouch this reader does not count, and the answer for no person at all. */
export const NOT_COUNTED: VouchCredit = { counts: false }

/**
 * Whether a recording's passing certificate or vouch counts as the person's
 * own. A certificate is the person's signature, so it always counts and
 * consults nothing. A vouch needs the reader's trust, or the person key's own
 * certificate for the device that recorded.
 *
 * `deviceKey` is the claim's. The verifier has already checked that the
 * certificate or vouch is for that same key.
 */
export function creditForPerson(
  recording: { deviceKey: string; person: VerifiedPerson },
  reader: {
    trustedHostKeys: ReadonlySet<string>
    certifiedDevice?: CertifiedDevice
  },
): VouchCredit {
  const { deviceKey, person } = recording
  if (person.via === 'certificate') {
    return { counts: true, because: 'certified-device' }
  }
  const { certifiedDevice } = reader
  // The person key signed for this very device, so what the host saw no
  // longer decides it.
  if (
    certifiedDevice &&
    certifiedDevice.personKey === person.personKey &&
    certifiedDevice.deviceKey === deviceKey
  ) {
    return { counts: true, because: 'certified-device' }
  }
  if (reader.trustedHostKeys.has(person.hostKey)) {
    return { counts: true, because: 'trusted-host' }
  }
  return NOT_COUNTED
}

const NO_HOSTS: TrustedHost[] = []

/** Shared across readers, so one list serves every Library row. */
let cached: Promise<TrustedHost[]> | undefined
const listeners = new Set<() => void>()

function ipcOf(appContext: AppContextValue) {
  return appContext.type === 'electron-client' ? appContext.ipc : undefined
}

/**
 * The trusted keys. Empty on anything but the desktop host, and empty rather
 * than throwing when the host cannot read its list: a reader that cannot tell
 * must label the vouch, not count it.
 */
export function readTrustedHosts(
  appContext: AppContextValue,
): Promise<TrustedHost[]> {
  const ipc = ipcOf(appContext)
  if (!ipc) {
    return Promise.resolve(NO_HOSTS)
  }
  // Started on a resolved promise, so a backend that answers nothing, or
  // throws on the spot, lands in the handlers below like any other failure.
  return (cached ??= Promise.resolve()
    .then(() => ipc.send<IpcResponse | undefined>('trust:get-hosts'))
    .then(
      (response) => {
        if (!response?.success) {
          return NO_HOSTS
        }
        const { hosts } = (response.data ?? {}) as { hosts?: TrustedHost[] }
        return hosts ?? NO_HOSTS
      },
      (error: unknown) => {
        console.warn('Could not read the trusted hosts:', error)
        return NO_HOSTS
      },
    ))
}

/** Drops the shared list and tells the readers to ask again. */
export function refreshTrustedHosts() {
  cached = undefined
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      // One reader throwing must not stop the others from refreshing.
      console.error('Trusted hosts listener failed', error)
    }
  }
}

export function subscribeToTrustedHosts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Trusts a host key, so its vouches count as the person's. `hostLabel` is the
 * name from the vouch it came from, left out for a key typed in by hand.
 */
export async function trustHost(
  appContext: AppContextValue,
  host: { hostKey: string; hostLabel?: string },
): Promise<boolean> {
  return change(appContext, (ipc) =>
    ipc.send<IpcResponse | undefined>('trust:add-host', {
      data: {
        hostKey: host.hostKey,
        ...(host.hostLabel !== undefined && { hostLabel: host.hostLabel }),
      },
    }),
  )
}

export async function untrustHost(
  appContext: AppContextValue,
  hostKey: string,
): Promise<boolean> {
  return change(appContext, (ipc) =>
    ipc.send<IpcResponse | undefined>('trust:remove-host', {
      data: { hostKey },
    }),
  )
}

async function change(
  appContext: AppContextValue,
  send: (
    ipc: NonNullable<ReturnType<typeof ipcOf>>,
  ) => Promise<IpcResponse | undefined>,
): Promise<boolean> {
  const ipc = ipcOf(appContext)
  if (!ipc) {
    return false
  }
  const response = await send(ipc)
  if (response?.success) {
    refreshTrustedHosts()
    return true
  }
  return false
}
