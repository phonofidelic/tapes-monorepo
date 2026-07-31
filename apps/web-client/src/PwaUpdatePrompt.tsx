/**
 * The "update available" toast.
 *
 * The worker is built with `registerType: 'prompt'` (see vite.config.ts), so a
 * new deploy installs in the background and waits rather than activating under
 * a running app — taking it mid-recording would be hostile. This is the only
 * affordance for accepting it; without one, a returning visitor would sit on
 * the old bundle indefinitely.
 *
 * Presentational only: registration and the decision to show this rather than
 * the install prompt both live in `ShellPrompts`.
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
