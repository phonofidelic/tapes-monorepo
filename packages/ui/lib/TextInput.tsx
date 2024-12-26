'use client'

import { useState } from 'react'
import { clsx } from 'clsx'

export function TextInput({
  value,
  defaultValue,
  id,
  type,
  name,
  label,
  autofocus,
  validate,
  onChange,
  onBlur,
  onKeyDown,
}: {
  id: string
  type: 'text' | 'email' | 'password'
  name: string
  label: string
  autofocus?: boolean
  value?: string
  defaultValue?: string
  validate?: (value: string) => string | undefined
  onChange?(event: React.ChangeEvent<HTMLInputElement>): void
  onBlur?(event: React.FocusEvent<HTMLInputElement>): void
  onKeyDown?(event: React.KeyboardEvent<HTMLInputElement>): void
}) {
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <div className="relative size-full">
      <input
        value={value}
        defaultValue={defaultValue}
        id={id}
        name={name}
        type={type}
        autoFocus={autofocus}
        placeholder={label}
        onChange={(event) => {
          setError(undefined)

          if (typeof onChange !== 'function') {
            return
          }

          if (typeof validate !== 'function') {
            onChange(event)
            return
          }

          const error = validate(event.target.value)

          if (!error) {
            onChange(event)
            return
          }

          setError(error)
          onChange(event)
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={clsx(
          'peer w-full rounded p-2 text-zinc-800 placeholder-transparent outline-none dark:bg-zinc-900 dark:text-white',
          {
            'outline-zinc-400': error === undefined,
            'outline-rose-500': error !== undefined,
          },
        )}
      />
      <label
        htmlFor={id}
        className={clsx(
          'absolute -top-4 left-2 bg-white p-1 text-sm transition-all peer-placeholder-shown:top-2 peer-placeholder-shown:p-0 peer-placeholder-shown:text-base peer-placeholder-shown:text-black peer-focus:-top-4 peer-focus:p-1 peer-focus:text-sm dark:bg-zinc-900',
          {
            'text-zinc-400 peer-focus:text-zinc-400': error === undefined,
            'text-rose-500 peer-focus:text-rose-500': error !== undefined,
          },
        )}
      >
        {error ?? label}
      </label>
    </div>
  )
}
