import { clsx } from 'clsx'
import React from 'react'

export default function Button({
  className,
  disabled,
  onClick,
  children,
}: {
  className?: string
  disabled?: boolean
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void
  children: React.ReactNode
}) {
  return (
    <button
      className={clsx(
        'flex size-full cursor-default items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800',
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
