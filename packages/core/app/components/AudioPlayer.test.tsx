import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { AutomergeUrl } from '@automerge/automerge-repo'
import { AudioPlayer } from './AudioPlayer'
import type {
  PlaybackFailure,
  PlaybackState,
} from '@/context/AudioPlayerContext'

vi.mock('@automerge/automerge-repo-react-hooks', () => ({
  useDocument: () => [{ name: 'Take one' }, vi.fn()],
}))

const seek = vi.fn()

type PlayerState = {
  duration: number
  seekableDuration: number
  currentTime: number
  playbackState: PlaybackState
  playbackFailure?: PlaybackFailure
}

let player: PlayerState

vi.mock('@/context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    audioRef: { current: null },
    currentUrl: 'automerge:recording' as AutomergeUrl,
    setCurrentUrl: vi.fn(),
    currentSource: undefined,
    setCurrentSource: vi.fn(),
    isPlaying: false,
    setIsPlaying: vi.fn(),
    seek,
    ...player,
  }),
}))

/** The transport is laid out by CSS, which jsdom does not do. */
const TRACK_WIDTH = 200

const renderPlayer = (state: Partial<PlayerState> = {}) => {
  player = {
    duration: 100,
    seekableDuration: 100,
    currentTime: 20,
    playbackState: 'ready',
    ...state,
  }
  render(<AudioPlayer />)
  const slider = screen.getByRole('slider')
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: TRACK_WIDTH,
    top: 0,
    height: 12,
    right: TRACK_WIDTH,
    bottom: 12,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return slider
}

/** Fraction of the track, as a client x coordinate. */
const atFraction = (fraction: number) => ({
  clientX: fraction * TRACK_WIDTH,
  pointerId: 1,
})

beforeEach(() => {
  seek.mockClear()
})

afterEach(cleanup)

describe('AudioPlayer transport bar', () => {
  it('seeks to the fraction of the duration that was clicked', () => {
    const slider = renderPlayer()

    fireEvent.pointerDown(slider, atFraction(0.25))
    fireEvent.pointerUp(slider, atFraction(0.25))

    expect(seek).toHaveBeenCalledWith(25)
  })

  it('follows the pointer while dragging and commits on release', () => {
    const slider = renderPlayer()

    fireEvent.pointerDown(slider, atFraction(0.1))
    fireEvent.pointerMove(slider, atFraction(0.6))

    // The readout tracks the hand before the audio has moved.
    expect(slider).toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByText('00:01:00')).toBeInTheDocument()

    fireEvent.pointerUp(slider, atFraction(0.6))
    expect(seek).toHaveBeenLastCalledWith(60)
  })

  it('clamps a drag that leaves the track', () => {
    const slider = renderPlayer()

    fireEvent.pointerDown(slider, atFraction(0.5))
    fireEvent.pointerUp(slider, { clientX: TRACK_WIDTH * 3, pointerId: 1 })

    expect(seek).toHaveBeenLastCalledWith(100)
  })

  it('ignores a move that is not part of a drag', () => {
    const slider = renderPlayer()

    fireEvent.pointerMove(slider, atFraction(0.9))

    expect(seek).not.toHaveBeenCalled()
    expect(slider).toHaveAttribute('aria-valuenow', '20')
  })

  it('nudges with the arrow keys and jumps with Home/End', () => {
    const slider = renderPlayer()

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(seek).toHaveBeenLastCalledWith(25)

    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(seek).toHaveBeenLastCalledWith(15)

    fireEvent.keyDown(slider, { key: 'Home' })
    expect(seek).toHaveBeenLastCalledWith(0)

    fireEvent.keyDown(slider, { key: 'End' })
    expect(seek).toHaveBeenLastCalledWith(100)
  })

  it('exposes slider semantics and is focusable', () => {
    const slider = renderPlayer()

    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '20')
    expect(slider).toHaveAttribute('aria-valuetext', '00:00:20')
    expect(slider).toHaveAttribute('tabindex', '0')
  })

  it.each([
    ['loading', { playbackState: 'loading' as const }],
    [
      'error',
      { playbackState: 'error' as const, playbackFailure: 'missing' as const },
    ],
    // What a MediaRecorder-written mp4 reports until it has been played through.
    ['a non-finite duration', { duration: Infinity, seekableDuration: 0 }],
  ])('is inert while %s', (_label, state) => {
    const slider = renderPlayer(state)

    fireEvent.pointerDown(slider, atFraction(0.5))
    fireEvent.pointerUp(slider, atFraction(0.5))
    fireEvent.keyDown(slider, { key: 'ArrowRight' })

    expect(seek).not.toHaveBeenCalled()
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveAttribute('tabindex', '-1')
    expect(slider).not.toHaveAttribute('aria-valuenow')
  })
})
