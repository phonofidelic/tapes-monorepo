import { useState } from 'react'
import type { IpcResponse, PendingVouch } from '@/IpcService'
import { useAppContext } from '@/context/AppContext'
import { usePendingVouches } from '@/hooks/usePendingVouches'

/**
 * On the host, the new devices waiting for the operator to say whose they are.
 * A guest that lost its keys picked a name on its phone. The operator checks
 * that the person holding it is that person, then says yes or no.
 *
 * The key fingerprint is on the guest's screen too, so two phones with the
 * same name can be told apart.
 */

const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

export function PendingVouches() {
  const appContext = useAppContext()
  const pending = usePendingVouches()

  if (appContext.type !== 'electron-client' || pending.length === 0) {
    return null
  }
  return (
    <section
      role="region"
      aria-labelledby="pending-vouches-title"
      className="fixed top-0 right-0 z-50 m-4 flex max-h-[60vh] w-96 flex-col gap-3 overflow-y-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-50 shadow-lg"
    >
      <h2 id="pending-vouches-title" className="font-medium">
        Waiting to join
      </h2>
      <ul className="flex flex-col gap-3">
        {pending.map((request) => (
          <PendingRow key={request.id} request={request} />
        ))}
      </ul>
    </section>
  )
}

function PendingRow({ request }: { request: PendingVouch }) {
  const appContext = useAppContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (appContext.type !== 'electron-client') {
    return null
  }
  const answer = async (channel: 'vouch:confirm' | 'vouch:reject') => {
    setBusy(true)
    setError(undefined)
    try {
      const response = await appContext.ipc.send<IpcResponse | undefined>(
        channel,
        { data: { id: request.id } },
      )
      if (!response?.success) {
        setError('That did not go through. The request may have expired.')
      }
    } catch (cause) {
      console.error('Could not answer a vouch request:', cause)
      setError('That did not go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const received = Date.parse(request.receivedAt)
  return (
    <li className="flex flex-col gap-2">
      <p>
        <span className="font-medium">{request.personName}</span> on “
        {request.deviceLabel}”
        <span className="block text-xs text-zinc-400">
          Key {request.deviceFingerprint}
          {Number.isNaN(received) ? '' : `, asked at ${time.format(received)}`}
        </span>
      </p>
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50 disabled:opacity-50"
          disabled={busy}
          onClick={() => void answer('vouch:reject')}
        >
          No
        </button>
        <button
          className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          disabled={busy}
          onClick={() => void answer('vouch:confirm')}
        >
          Yes, that&apos;s {request.personName}
        </button>
      </div>
    </li>
  )
}
