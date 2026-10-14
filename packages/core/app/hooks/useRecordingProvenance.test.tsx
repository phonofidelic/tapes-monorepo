import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  createRecordingClaim,
  generateSigningKeyPair,
  statementAddress,
  statementBytes,
} from '@tapes-monorepo/provenance'
import { BlobProvider } from '@/context/BlobContext'
import { clearStatementCache } from '@/recordingProvenance'
import { useRecordingProvenance } from './useRecordingProvenance'

const ENDPOINTS = [{ baseUrl: 'http://127.0.0.1:9001', token: 'host' }]

const blob = { hash: 'ab'.repeat(32), size: 1024 }

const claim = await createRecordingClaim(
  {
    blob: { ...blob, mimeType: 'audio/mp4' },
    startedAt: '2026-10-05T12:00:00.000Z',
    endedAt: '2026-10-05T12:03:00.000Z',
  },
  await generateSigningKeyPair(),
)
const claimHash = await statementAddress(claim)

function Probe({ statements }: { statements?: string[] }) {
  const provenance = useRecordingProvenance({ blob, statements })
  return <span data-testid="state">{provenance.state}</span>
}

function renderProbe(statements?: string[]) {
  return render(
    <BlobProvider endpoints={ENDPOINTS}>
      <Probe statements={statements} />
    </BlobProvider>,
  )
}

beforeEach(() => {
  clearStatementCache()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith(claimHash)
          ? new Response(statementBytes(claim).slice(), { status: 200 })
          : new Response(null, { status: 404 }),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useRecordingProvenance', () => {
  it('shows checking until the statements are verified', async () => {
    renderProbe([claimHash])

    expect(screen.getByTestId('state')).toHaveTextContent('checking')
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('device-only'),
    )
  })

  it('checks again when the listed statements change', async () => {
    const { rerender } = renderProbe([claimHash])
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('device-only'),
    )

    rerender(
      <BlobProvider endpoints={ENDPOINTS}>
        <Probe statements={[claimHash, 'cd'.repeat(32)]} />
      </BlobProvider>,
    )

    // The earlier result answered a different list, so it is not shown.
    expect(screen.getByTestId('state')).toHaveTextContent('checking')
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('unavailable'),
    )
  })

  it('does not check again when the same list arrives as a new array', async () => {
    const { rerender } = renderProbe([claimHash])
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('device-only'),
    )
    const calls = vi.mocked(fetch).mock.calls.length

    rerender(
      <BlobProvider endpoints={ENDPOINTS}>
        <Probe statements={[claimHash]} />
      </BlobProvider>,
    )

    expect(screen.getByTestId('state')).toHaveTextContent('device-only')
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls)
  })
})
