/** The panel each first-join step shows in, pinned above the bottom dock. */
export function PromptFrame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      role="dialog"
      aria-labelledby="person-key-prompt-title"
      className="fixed inset-x-0 bottom-0 z-50 m-4 flex max-h-[90vh] flex-col gap-3 overflow-y-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-50 shadow-lg md:left-auto md:w-96"
    >
      <h2 id="person-key-prompt-title" className="font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}
