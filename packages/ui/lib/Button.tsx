'use client'

import * as React from 'react'
import { clsx } from 'clsx'

export function Button({
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
        'flex items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800',
        className,
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
