import { useId, useState } from 'react'
import { useLocalName } from '@/hooks/useLocalNames'
import { localNameClashes, setLocalName, type NamedKeyKind } from '@/localNames'

/**
 * Where the operator names a key, used on every surface that shows one.
 *
 * The name is this device's own. It is never suggested and never derived from
 * what arrived over the wire, because a suggested name reads as proof of
 * identity when it is only an echo. Saving an empty field forgets the name, so
 * one control both names and unnames.
 *
 * A name already used by another key of the same kind is a warning, not a
 * refusal. An operator with two phones that really are both "Studio phone"
 * must still be able to say so.
 */

/** The shared Button's classes, since a form button cannot use that one. */
const DEFAULT_BUTTON_CLASS =
  'flex items-center rounded-sm p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800'

export function LocalNameControls({
  publicKey,
  kind,
  what,
  buttonClassName = DEFAULT_BUTTON_CLASS,
}: {
  publicKey: string
  kind: NamedKeyKind
  /** The noun on the button, such as "device", "person" or "host". */
  what: string
  /**
   * Replaces the default button classes. Passed by a surface with a fixed
   * background of its own, where the default hover is the wrong colour.
   */
  buttonClassName?: string
}) {
  const named = useLocalName(publicKey)
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setEditing(true)}
      >
        {named === undefined ? `Name this ${what}` : `Rename this ${what}`}
      </button>
    )
  }
  return (
    <LocalNameForm
      publicKey={publicKey}
      kind={kind}
      what={what}
      named={named}
      buttonClassName={buttonClassName}
      onDone={() => setEditing(false)}
    />
  )
}

function LocalNameForm({
  publicKey,
  kind,
  what,
  named,
  buttonClassName,
  onDone,
}: {
  publicKey: string
  kind: NamedKeyKind
  what: string
  named: string | undefined
  buttonClassName: string
  onDone: () => void
}) {
  const inputId = useId()
  const [value, setValue] = useState(named ?? '')
  const clashes = localNameClashes({ key: publicKey, kind, name: value })

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        setLocalName({ key: publicKey, kind, name: value })
        onDone()
      }}
    >
      <label htmlFor={inputId}>What do you call this {what}?</label>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        maxLength={64}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="rounded-sm bg-transparent p-1 ring-1 ring-zinc-400"
      />
      {clashes.length > 0 && (
        <p role="status">
          Another {what} is already called “{clashes[0]?.name}”. You can still
          use it.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <button type="submit" className={buttonClassName}>
          {value.trim().length === 0 ? 'Forget this name' : 'Save'}
        </button>
        <button type="button" className={buttonClassName} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
