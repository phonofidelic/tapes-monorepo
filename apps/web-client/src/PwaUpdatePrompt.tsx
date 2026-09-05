/**
 * The "update available" toast. Presentational only: registration and the
 * choice between this and the install prompt live in ShellPrompts.
 *
 * The worker uses `registerType: 'prompt'` (see vite.config.ts), so a new
 * deploy installs in the background and waits instead of replacing the bundle
 * under a running recording. This toast is the only way a user accepts that
 * update. Without it a returning visitor would stay on the old bundle for good.
 */
export default function PwaUpdatePrompt({
  onLater,
  onReload,
}: {
  onLater: () => void
  onReload: () => void
}) {
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 m-4 flex items-center justify-between gap-4 rounded-lg bg-zinc-900 p-4 text-sm text-zinc-50 shadow-lg"
    >
      <p>A new version of Tapes is available.</p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-50"
          onClick={onLater}
        >
          Later
        </button>
        <button
          className="rounded-md bg-zinc-50 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-200"
          onClick={onReload}
        >
          Reload
        </button>
      </div>
    </div>
  )
}
