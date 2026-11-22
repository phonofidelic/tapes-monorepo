import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readLocalName, setLocalName } from '@/localNames'
import { LocalNameControls } from './LocalNameControls'

/**
 * The one control that names a key, wherever it is shown.
 *
 * What matters here is what it refuses to do as much as what it does. It
 * suggests nothing, because a suggested name reads as proof of identity. And
 * it warns about a name already in use without refusing it.
 */

const PHONE_KEY = 'phone-key'

const renderControls = () =>
  render(
    <LocalNameControls publicKey={PHONE_KEY} kind="device" what="device" />,
  )

describe('LocalNameControls', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('offers to name a key nobody has named', () => {
    renderControls()

    expect(
      screen.getByRole('button', { name: 'Name this device' }),
    ).toBeInTheDocument()
  })

  it('suggests nothing in the field', async () => {
    renderControls()

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('saves what the operator typed', async () => {
    renderControls()

    await userEvent.click(screen.getByRole('button'))
    await userEvent.type(screen.getByRole('textbox'), 'Studio phone')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(readLocalName(PHONE_KEY)).toBe('Studio phone')
    expect(
      screen.getByRole('button', { name: 'Rename this device' }),
    ).toBeInTheDocument()
  })

  it('opens on the name already saved', async () => {
    setLocalName({ key: PHONE_KEY, kind: 'device', name: 'Studio phone' })

    renderControls()
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename this device' }),
    )

    expect(screen.getByRole('textbox')).toHaveValue('Studio phone')
  })

  it('forgets the name when the field is emptied', async () => {
    setLocalName({ key: PHONE_KEY, kind: 'device', name: 'Studio phone' })

    renderControls()
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename this device' }),
    )
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Forget this name' }),
    )

    expect(readLocalName(PHONE_KEY)).toBeUndefined()
    expect(
      screen.getByRole('button', { name: 'Name this device' }),
    ).toBeInTheDocument()
  })

  it('keeps the saved name when the operator cancels', async () => {
    setLocalName({ key: PHONE_KEY, kind: 'device', name: 'Studio phone' })

    renderControls()
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename this device' }),
    )
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), 'Something else')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(readLocalName(PHONE_KEY)).toBe('Studio phone')
  })

  it('warns about a name another device already has, and saves it anyway', async () => {
    setLocalName({ key: 'other-key', kind: 'device', name: 'Studio phone' })

    renderControls()
    await userEvent.click(screen.getByRole('button'))
    await userEvent.type(screen.getByRole('textbox'), 'studio phone')

    expect(screen.getByRole('status')).toHaveTextContent(
      'Another device is already called “Studio phone”',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(readLocalName(PHONE_KEY)).toBe('studio phone')
  })

  it('does not warn about a name used for another kind of key', async () => {
    setLocalName({ key: 'sam-key', kind: 'person', name: 'Sam' })

    renderControls()
    await userEvent.click(screen.getByRole('button'))
    await userEvent.type(screen.getByRole('textbox'), 'Sam')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
