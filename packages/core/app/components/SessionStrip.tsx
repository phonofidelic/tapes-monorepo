import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button } from '@tapes-monorepo/ui'
import { useDocument } from '@automerge/automerge-repo-react-hooks'
import { useAppContext } from '@/context/AppContext'
import { useHostConnection } from '@/context/HostConnectionContext'
import { useRecorder } from '@/context/RecordingContext'
import { useRequiredAutomergeUrl } from '@/utils'
import type {
  IpcService,
  HostSessionResponse,
  SessionSettledEvent,
} from '@/IpcService'
import type { SyncServerInfo } from '@/services/SyncService'
import type { ClosedSession, PublishedSession, RootDocument } from '@/types'
import {
  formatClockTime,
  formatSessionClock,
  shortSessionId,
} from '@/sessionFormat'

/**
 * The 40px session strip at the top of the Recorder. The electron app is the
 * host and gets the start and stop control. A paired web guest gets a
 * read-only indicator. A web client with no host shows no strip.
 */
export function SessionStrip() {
  const appContext = useAppContext()
  const hostConnection = useHostConnection()
  if (appContext.type === 'electron-client') {
    return <HostSessionControl ipc={appContext.ipc} />
  }
  if (hostConnection === 'unpaired') {
    return null
  }
  return <GuestSessionIndicator online={hostConnection === 'connected'} />
}

/** Whether `SessionStrip` renders anything, for laying out around it. */
export function useHasSessionStrip(): boolean {
  const appContext = useAppContext()
  const hostConnection = useHostConnection()
  return appContext.type === 'electron-client' || hostConnection !== 'unpaired'
}

type Dot = 'idle' | 'open' | 'failed' | 'unreachable'

function Strip({
  dot,
  title,
  detail,
  action,
}: {
  dot: Dot
  title: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <div
      role="status"
      className={clsx(
        'bg-subtle relative z-50 flex h-10 w-full shrink-0 items-center gap-2 pl-4 text-xs leading-4 font-medium',
        action ? 'pr-2' : 'pr-4',
      )}
    >
      <span
        aria-hidden
        data-dot={dot}
        className={clsx('size-2 shrink-0 rounded-full', {
          'bg-muted': dot === 'idle',
          'bg-green-500': dot === 'open',
          'bg-rose-500': dot === 'failed',
          'border-muted border': dot === 'unreachable',
        })}
      />
      <p className="shrink-0 whitespace-nowrap text-zinc-800 dark:text-zinc-100">
        {title}
      </p>
      <p className="text-muted min-w-px flex-1 truncate">{detail}</p>
      {action}
    </div>
  )
}

/** Re-renders every second while `active`, returning the current time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return
    }
    const tick = () => setNow(Date.now())
    // The held time is stale from when the clock last ran.
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [active])
  return now
}

async function isServerRunning(ipc: IpcService): Promise<boolean> {
  try {
    const info = await ipc.send<SyncServerInfo>('sync:get-server-info')
    return info?.running ?? false
  } catch (error) {
    console.error('Could not read the sync server state:', error)
    return false
  }
}

type Stopped = ClosedSession & {
  settled?: Omit<SessionSettledEvent, 'sessionId'>
}

/**
 * The host's control. The main process owns the session. This asks it over
 * IPC and shows its answers. The published doc field is not read here.
 */
export function HostSessionControl({ ipc }: { ipc: IpcService }) {
  const { automergeUrl } = useRequiredAutomergeUrl()
  const [open, setOpen] = useState<PublishedSession | undefined>()
  // The last stopped session, kept until the next start.
  const [stopped, setStopped] = useState<Stopped | undefined>()
  const [serverRunning, setServerRunning] = useState<boolean | undefined>()
  const [busy, setBusy] = useState(false)
  const now = useNow(
    open !== undefined || (stopped !== undefined && !stopped.settled),
  )

  useEffect(() => {
    let cancelled = false
    // Subscribed before asking, so a record that settles meanwhile is heard.
    const unsubscribe = ipc.subscribe<SessionSettledEvent>(
      'session:settled',
      (event) => {
        if (!event) {
          return
        }
        const { sessionId, ...settled } = event
        setStopped((current) =>
          current?.sessionId === sessionId ? { ...current, settled } : current,
        )
      },
    )
    void isServerRunning(ipc).then((running) => {
      if (!cancelled) {
        setServerRunning(running)
      }
    })
    ipc
      .send<HostSessionResponse>('session:get-current')
      .then((response) => {
        if (!cancelled && response?.success) {
          setOpen(response.data.session)
        }
      })
      .catch((error: unknown) => {
        console.error('Could not read the host session:', error)
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [ipc])

  const start = async () => {
    setBusy(true)
    try {
      const response = await ipc.send<HostSessionResponse>('session:start', {
        data: { docUrl: automergeUrl },
      })
      if (response.success) {
        setOpen(response.data.session)
        setStopped(undefined)
        return
      }
      console.error('Could not start a session:', response.error)
      setServerRunning(await isServerRunning(ipc))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try {
      const response = await ipc.send<HostSessionResponse>('session:stop')
      if (!response.success) {
        console.error('Could not stop the session:', response.error)
        return
      }
      setOpen(undefined)
      setStopped(response.data.closed)
    } finally {
      setBusy(false)
    }
  }

  const actionClass =
    'bg-page rounded-sm border border-zinc-200 px-3 py-1.5 text-xs leading-4 font-medium text-zinc-800 disabled:text-muted disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100'

  if (open) {
    return (
      <Strip
        dot="open"
        title={`Session ${shortSessionId(open.sessionId)}`}
        detail={`open ${formatSessionClock(now - Date.parse(open.startedAt))}`}
        action={
          <Button className={actionClass} disabled={busy} onClick={stop}>
            Stop
          </Button>
        }
      />
    )
  }

  const startButton = (
    <Button
      className={actionClass}
      disabled={busy || serverRunning !== true}
      onClick={start}
    >
      Start session
    </Button>
  )

  if (serverRunning === false) {
    return (
      <Strip
        dot="unreachable"
        title="No session"
        detail="the sync server is off"
        action={startButton}
      />
    )
  }

  if (stopped) {
    const short = shortSessionId(stopped.sessionId)
    const { settled } = stopped
    return (
      <Strip
        dot={settled && !settled.signedAt ? 'failed' : 'idle'}
        title="No session"
        detail={
          !settled
            ? `${short} signs in ${formatSessionClock(Date.parse(stopped.signsAt) - now)}`
            : settled.signedAt
              ? `${short} signed at ${formatClockTime(settled.signedAt)}`
              : `${short} could not be signed`
        }
        action={startButton}
      />
    )
  }

  return (
    <Strip
      dot="idle"
      title="No session"
      detail="takes have no session"
      action={startButton}
    />
  )
}

/** The session a take started in, captured when recording began. */
type Take = { session: PublishedSession | undefined; online: boolean }

/**
 * A guest's read-only view of the host session. It trusts the doc only while
 * connected to the host. Offline, it records with no session whatever the doc
 * says. During a take it describes the take's session, not the live one.
 */
export function GuestSessionIndicator({ online }: { online: boolean }) {
  const { automergeUrl } = useRequiredAutomergeUrl()
  const [doc] = useDocument<RootDocument>(automergeUrl, { suspense: true })
  const { isRecording } = useRecorder()
  const live = online ? doc?.session : undefined

  // Captured during render on the rising edge, so the first recording frame
  // already shows the take's session.
  const [take, setTake] = useState<Take | undefined>()
  const [wasRecording, setWasRecording] = useState(isRecording)
  if (isRecording !== wasRecording) {
    setWasRecording(isRecording)
    setTake(isRecording ? { session: live, online } : undefined)
  }

  const now = useNow(live !== undefined && !take)

  if (take) {
    if (!take.session) {
      return take.online ? (
        <Strip
          dot="idle"
          title="No session"
          detail="this take has no session"
        />
      ) : (
        <Strip
          dot="unreachable"
          title="Can't reach the host"
          detail="this take has no session"
        />
      )
    }
    const short = shortSessionId(take.session.sessionId)
    if (!online) {
      return (
        <Strip
          dot="unreachable"
          title="Can't reach the host"
          detail={`this take stays in ${short}`}
        />
      )
    }
    return live?.sessionId === take.session.sessionId ? (
      <Strip
        dot="open"
        title={`Session ${short}`}
        detail="this take is in it"
      />
    ) : (
      <Strip
        dot="idle"
        title={`Session ${short} stopped`}
        detail="this take stays in it"
      />
    )
  }

  if (!online) {
    return (
      <Strip
        dot="unreachable"
        title="Can't reach the host"
        detail="takes have no session"
      />
    )
  }

  if (live) {
    return (
      <Strip
        dot="open"
        title={`Session ${shortSessionId(live.sessionId)}`}
        detail={`open ${formatSessionClock(now - Date.parse(live.startedAt))}`}
      />
    )
  }

  return (
    <Strip
      dot="idle"
      title="No session"
      detail="takes recorded now have no session"
    />
  )
}
