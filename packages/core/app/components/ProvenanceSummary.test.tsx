import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NO_SESSION_ID } from '@tapes-monorepo/provenance'
import { AppContextProvider } from '@/context/AppContext'
import type { IpcService } from '@/IpcService'
import type { ProvenanceState } from '@/hooks/useRecordingProvenance'
import { readLocalName, setLocalName } from '@/localNames'
import { ProvenanceSummary } from './ProvenanceSummary'

/**
 * What a Library row says about who made a recording, once the operator has
 * named the keys behind it.
 *
 * The provenance check itself is covered by `recordingProvenance.test.ts`, so
 * it is mocked here. What is under test is the naming: whose word each name is
 * and which one wins.
 */

const DEVICE_KEY = 'phone-device-key'
const PERSON_KEY = 'sam-person-key'
const HOST_KEY = 'studio-host-key'

const state = vi.hoisted(() => ({
  current: { state: 'checking' } as ProvenanceState,
}))

vi.mock('@/hooks/useRecordingProvenance', () => ({
  useRecordingProvenance: () => state.current,
}))

vi.mock('@/localDeviceKey', () => ({
  readLocalDeviceKey: () => Promise.resolve('this-device-key'),
}))

vi.mock('@/personKey', () => ({
  readPersonKeyStatus: () => Promise.resolve({ exists: false }),
}))

/** A take the host received, on a device a host vouched for. */
const vouched: ProvenanceState = {
  state: 'verified',
  receivedAt: '2026-11-20T18:05:00.000Z',
  recordedByHost: false,
  deviceKey: DEVICE_KEY,
  startedAt: '2026-11-20T18:00:00.000Z',
  endedAt: '2026-11-20T18:04:00.000Z',
  sessionId: NO_SESSION_ID,
  deviceLink: 'bb'.repeat(32),
  person: {
    via: 'vouch',
    personKey: PERSON_KEY,
    personName: 'Sam',
    deviceLabel: 'iPhone · Safari',
    hostKey: HOST_KEY,
    hostLabel: 'Studio Mac',
    method: 'operator',
    vouchedAt: '2026-11-20T17:50:00.000Z',
  },
}

function renderSummary(provenance: ProvenanceState = vouched) {
  state.current = provenance
  return render(
    <AppContextProvider
      value={{
        type: 'electron-client',
        ipc: { send: vi.fn() } as unknown as IpcService,
      }}
    >
      <ProvenanceSummary recording={{ statements: [] }} />
    </AppContextProvider>,
  )
}

describe('ProvenanceSummary', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('falls back to the names in the statements when nothing is named', async () => {
    const { container } = renderSummary()

    await waitFor(() => expect(container).toHaveTextContent('Recorded by Sam'))
    expect(container).toHaveTextContent('“iPhone · Safari”')
    expect(container).toHaveTextContent('vouched by Studio Mac')
  })

  // The roster name on a vouch is the host's, and the person never signed it.
  it('leads with the operator’s name for the person', async () => {
    setLocalName({ key: PERSON_KEY, kind: 'person', name: 'Sam Okafor' })

    const { container } = renderSummary()

    await waitFor(() =>
      expect(container).toHaveTextContent('Recorded by Sam Okafor'),
    )
  })

  it('leads with the operator’s name for the device', async () => {
    setLocalName({ key: DEVICE_KEY, kind: 'device', name: 'Stage phone' })

    const { container } = renderSummary()

    await waitFor(() => expect(container).toHaveTextContent('on Stage phone'))
    // The device's own label stays visible, in quotes, as the claim it is.
    expect(container).toHaveTextContent('“iPhone · Safari”')
  })

  it('leads with the operator’s name for the vouching host', async () => {
    setLocalName({ key: HOST_KEY, kind: 'host', name: 'The big Mac' })

    const { container } = renderSummary()

    await waitFor(() =>
      expect(container).toHaveTextContent('vouched by The big Mac'),
    )
  })

  it('offers to name every key the row names', async () => {
    renderSummary()

    expect(
      await screen.findByRole('button', { name: 'Name this device' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Name this person' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Name this host' }),
    ).toBeInTheDocument()
  })

  it('saves a name typed on the row', async () => {
    renderSummary()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Name this device' }),
    )
    await userEvent.type(screen.getByRole('textbox'), 'Stage phone')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(readLocalName(DEVICE_KEY)).toBe('Stage phone')
  })

  // Nothing is named on a take with no statements, so there is nothing to ask
  // about either.
  it('offers no naming for a recording with no signatures', async () => {
    renderSummary({ state: 'unverified' })

    expect(
      await screen.findByText(/There is no record of which device made it/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
