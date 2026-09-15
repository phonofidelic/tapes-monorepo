import { EventEmitter } from 'events'
import type { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSyncConnectionRegistry,
  type SyncConnection,
} from './syncConnections'

/**
 * A socket that records its pings and terminations. Real sockets cannot be made
 * to go silent on demand, and that silence is what the keepalive exists for.
 */
class FakeSocket extends EventEmitter {
  pings = 0
  terminated = false

  ping() {
    this.pings++
  }

  terminate() {
    this.terminated = true
    this.emit('close')
  }

  /** Answers the last ping, as a live socket does. */
  pong() {
    this.emit('pong')
  }

  asWebSocket() {
    return this as unknown as WebSocket
  }
}

const HEARTBEAT_MS = 1000

function setup() {
  const changes: SyncConnection[][] = []
  const registry = createSyncConnectionRegistry({
    onChange: (connections) => changes.push(connections),
    heartbeatIntervalMs: HEARTBEAT_MS,
    now: () => 1_700_000_000_000,
  })
  return { registry, changes }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createSyncConnectionRegistry', () => {
  it('lists a connection with what the handshake gave', () => {
    const { registry } = setup()
    const socket = new FakeSocket()

    registry.add(socket.asWebSocket(), {
      label: 'Studio iPad',
      address: '192.168.1.24',
      self: false,
    })

    expect(registry.list()).toEqual([
      {
        id: expect.any(String),
        label: 'Studio iPad',
        address: '192.168.1.24',
        connectedAt: 1_700_000_000_000,
        self: false,
      },
    ])
  })

  it('gives each connection its own id', () => {
    const { registry } = setup()

    const first = registry.add(new FakeSocket().asWebSocket(), { self: false })
    const second = registry.add(new FakeSocket().asWebSocket(), { self: false })

    expect(first.id).not.toBe(second.id)
  })

  it('emits the new list on connect and on close', () => {
    const { registry, changes } = setup()
    const socket = new FakeSocket()

    registry.add(socket.asWebSocket(), { label: 'Phone', self: false })
    socket.emit('close')

    expect(changes.map((list) => list.length)).toEqual([1, 0])
    expect(registry.list()).toEqual([])
  })

  it('emits nothing more when a socket closes twice', () => {
    const { registry, changes } = setup()
    const socket = new FakeSocket()

    registry.add(socket.asWebSocket(), { self: false })
    socket.emit('close')
    socket.emit('close')

    expect(changes).toHaveLength(2)
  })

  it('drops a connection whose socket errors', () => {
    const { registry } = setup()
    const socket = new FakeSocket()

    registry.add(socket.asWebSocket(), { self: false })
    socket.emit('error', new Error('reset by peer'))

    expect(registry.list()).toEqual([])
  })

  // A phone carried out of range leaves the socket open on this side. Without
  // the keepalive it would show as connected until the app restarts.
  it('evicts a socket that stops answering pings', () => {
    const { registry, changes } = setup()
    const socket = new FakeSocket()
    registry.add(socket.asWebSocket(), { label: 'Phone', self: false })

    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(socket.pings).toBe(1)
    expect(registry.list()).toHaveLength(1)

    vi.advanceTimersByTime(HEARTBEAT_MS)

    expect(socket.terminated).toBe(true)
    expect(registry.list()).toEqual([])
    expect(changes.at(-1)).toEqual([])
  })

  it('keeps a socket that answers', () => {
    const { registry } = setup()
    const socket = new FakeSocket()
    registry.add(socket.asWebSocket(), { label: 'Phone', self: false })

    for (let tick = 0; tick < 5; tick++) {
      vi.advanceTimersByTime(HEARTBEAT_MS)
      socket.pong()
    }

    expect(socket.terminated).toBe(false)
    expect(registry.list()).toHaveLength(1)
  })

  it('stops pinging and empties the list when closed', () => {
    const { registry, changes } = setup()
    const socket = new FakeSocket()
    registry.add(socket.asWebSocket(), { self: false })

    registry.close()
    vi.advanceTimersByTime(HEARTBEAT_MS * 3)

    expect(socket.pings).toBe(0)
    expect(registry.list()).toEqual([])
    expect(changes.at(-1)).toEqual([])
  })
})
