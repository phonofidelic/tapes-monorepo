import { Button } from '@tapes-monorepo/ui'
import { LocalNameControls } from '@/components/LocalNameControls'
import { useAppContext } from '@/context/AppContext'
import { useKeyFingerprint } from '@/hooks/useKeyFingerprint'
import { useLocalName } from '@/hooks/useLocalNames'
import { useTrustedHosts } from '@/hooks/useTrustedHosts'
import { untrustHost, type TrustedHost } from '@/trustedHosts'

/**
 * The other hosts whose vouches this operator counts as the person's own. A
 * host is added from the vouch shown on a Library row, which is where its key
 * and its label come from, and dropped again here.
 *
 * Each host is shown by key fingerprint as well as name. The operator's own
 * name for the host leads where there is one. The label beside it is the
 * host's own name for itself and proves nothing, so it is never the only
 * thing on the line.
 */
export function TrustedHostsSettings() {
  const appContext = useAppContext()
  const hosts = useTrustedHosts()

  if (appContext.type !== 'electron-client') {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      <h2>Trusted hosts</h2>
      {hosts.length === 0 ? (
        <p className="pl-2 text-xs text-zinc-500">
          No other host is trusted. A recording signed on a device another host
          vouched for offers that host in its details in the Library.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 pl-2 text-sm">
          {hosts.map((host) => (
            <HostRow key={host.hostKey} {...host} />
          ))}
        </ul>
      )}
    </div>
  )
}

function HostRow({ hostKey, hostLabel }: TrustedHost) {
  const fingerprint = useKeyFingerprint(hostKey)
  const named = useLocalName(hostKey)
  return (
    <li className="flex flex-col gap-1">
      <span>
        {named ?? `“${hostLabel}”`}
        <span className="block text-xs text-zinc-500">
          {named !== undefined && `Calls itself “${hostLabel}”. `}key{' '}
          {fingerprint ?? '…'}
        </span>
      </span>
      <div className="flex flex-wrap gap-1">
        <LocalNameControls
          publicKey={hostKey}
          kind="host"
          what="host"
          // Matches the button beside it, which uses the shared component.
          buttonClassName="flex w-fit items-center rounded-sm p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        />
        <Button className="w-fit p-2" onClick={() => untrustHost(hostKey)}>
          Stop trusting this host
        </Button>
      </div>
    </li>
  )
}
