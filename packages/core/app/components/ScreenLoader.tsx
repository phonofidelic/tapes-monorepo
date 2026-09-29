import { AppIcon } from '@tapes-monorepo/ui'

export function ScreenLoader({
  message = 'Loading...',
  children,
}: {
  message: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2">
      <div className="size-39 opacity-75">
        <AppIcon />
      </div>
      <div className="text-muted w-full text-center text-lg/7">{message}</div>
      <div className="flex w-full justify-center">{children}</div>
    </div>
  )
}
