import { useEffect, useState } from 'react'
import { keyFingerprint } from '@tapes-monorepo/provenance'
import { Button } from '@tapes-monorepo/ui'
import type { TrustedHost } from '@/IpcService'
import { useAppContext } from '@/context/AppContext'
import { useTrustedHosts } from '@/hooks/useTrustedHosts'

/**
 * On the host, the other hosts whose vouches its operator counts as the
 * person's own signature. The Library labels every other host's vouch with the
 * host that signed it.
 *
 * A key is shown by its fingerprint, with the host's name from the vouch it
 * was trusted from. The operator normally trusts a host from such a vouch in
 * the Library, where the name is in front of them. The field here is for a key
 * read off the other host's pairing link, which carries no name.
 */
export function TrustedHostSettings() {
  const appContext = useAppContext()
  const { hosts, trust, untrust } = useTrustedHosts()

  if (appContext.type !== 'electron-client' || !hosts) {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      <h2>Trusted hosts</h2>
      <p className="pl-2 text-xs text-zinc-500">
        A vouch from one of these hosts counts as the person&apos;s own
        signature. Any other host&apos;s vouch is shown with its name.
      </p>
      {hosts.length === 0 ? (
        <p className="pl-2 text-sm">No other host is trusted.</p>
      ) : (
        <ul className="flex flex-col gap-3 pl-2 text-sm">
          {hosts.map((host) => (
            <TrustedHostRow
              key={host.hostKey}
              host={host}
              onRemove={() => untrust(host.hostKey)}
            />
          ))}
        </ul>
      )}
      <AddTrustedHost trust={trust} />
    </div>
  )
}

function useFingerprint(key: string): string | undefined {
  const [held, setHeld] = useState<{ key: string; fingerprint?: string }>()
  useEffect(() => {
    let current = true
    void keyFingerprint(key).then(
      (fingerprint) => current && setHeld({ key, fingerprint }),
    )
    return () => {
      current = false
    }
  }, [key])
  return held?.key === key ? held.fingerprint : undefined
}

function TrustedHostRow({
  host,
  onRemove,
}: {
  host: TrustedHost
  onRemove: () => Promise<boolean>
}) {
  const fingerprint = useFingerprint(host.hostKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  return (
    <li className="flex flex-col gap-1">
      <p>
        <span className="font-medium">
          {host.hostLabel ? `“${host.hostLabel}”` : 'Host'}
        </span>
        <span className="block font-mono text-xs text-zinc-500">
          {fingerprint ?? host.hostKey}
        </span>
      </p>
      {error && (
        <p role="alert" className="text-rose-500">
          {error}
        </p>
      )}
      <Button
        className="w-fit p-2"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(undefined)
          try {
            if (!(await onRemove())) {
              setError('That did not go through. Try again.')
            }
          } finally {
            setBusy(false)
          }
        }}
      >
        Stop trusting
      </Button>
    </li>
  )
}

function AddTrustedHost({
  trust,
}: {
  trust: (host: { hostKey: string }) => Promise<boolean>
}) {
  const [hostKey, setHostKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  return (
    <form
      className="flex flex-wrap items-end gap-2 pl-2"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)
        try {
          if (await trust({ hostKey: hostKey.trim() })) {
            setHostKey('')
          } else {
            // The host checks the key itself, so a typo lands here.
            setError('That is not a host key.')
          }
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs">Trust another host by its key</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={hostKey}
          placeholder="hk from its pairing link"
          onChange={(event) => setHostKey(event.target.value)}
          className="rounded-sm bg-transparent p-2 font-mono text-xs ring-1 ring-zinc-400"
        />
      </label>
      {/* A plain button, because the shared one cannot take a type. */}
      <button
        type="submit"
        className="w-fit rounded-sm p-2 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
        disabled={busy || hostKey.trim().length === 0}
      >
        Trust host
      </button>
      {error && (
        <p role="alert" className="w-full text-rose-500">
          {error}
        </p>
      )}
    </form>
  )
}
