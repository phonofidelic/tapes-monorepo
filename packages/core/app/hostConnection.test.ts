import { describe, expect, it, vi } from 'vitest'
import { createHostConnection } from './hostConnection'

/** Stands in for an automerge network adapter's peer events. */
class EventEmitter {
  private listeners = new Map<string, Set<() => void>>()
  on(event: string, listener: () => void) {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
  }
  off(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener)
  }
  emit(event: string) {
    this.listeners.get(event)?.forEach((listener) => listener())
  }
}

/** The peer-event half of an adapter, for spreading into a wider fake. */
function bind(adapter: EventEmitter) {
  return {
    on: (event: string, listener: () => void) => adapter.on(event, listener),
    off: (event: string, listener: () => void) => adapter.off(event, listener),
  }
}

describe('the host connection', () => {
  it('starts offline and follows the adapter peer', () => {
    const adapter = new EventEmitter()
    const connection = createHostConnection(adapter)
    const listener = vi.fn()
    connection.subscribe(listener)

    expect(connection.isConnected()).toBe(false)

    adapter.emit('peer-candidate')
    expect(connection.isConnected()).toBe(true)

    adapter.emit('peer-disconnected')
    expect(connection.isConnected()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not notify when nothing changed', () => {
    const adapter = new EventEmitter()
    const connection = createHostConnection(adapter)
    const listener = vi.fn()
    connection.subscribe(listener)

    adapter.emit('peer-disconnected')

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const adapter = new EventEmitter()
    const connection = createHostConnection(adapter)
    const listener = vi.fn()
    connection.subscribe(listener)()

    adapter.emit('peer-candidate')

    expect(listener).not.toHaveBeenCalled()
  })

  it('is never revoked on an adapter that cannot say', () => {
    const connection = createHostConnection(new EventEmitter())

    expect(connection.isRevoked()).toBe(false)
  })

  it('follows an adapter that says the host revoked this device', () => {
    const adapter = new EventEmitter()
    let notifyRevoked = () => {}
    const connection = createHostConnection({
      ...bind(adapter),
      isRevoked: () => false,
      onRevoked: (listener) => {
        notifyRevoked = listener
      },
    })
    const listener = vi.fn()
    connection.subscribe(listener)

    expect(connection.isRevoked()).toBe(false)
    notifyRevoked()

    expect(connection.isRevoked()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  // A revoked key is known before the first socket, on a reconnect after a
  // reload.
  it('starts revoked when the adapter already is', () => {
    const connection = createHostConnection({
      ...bind(new EventEmitter()),
      isRevoked: () => true,
      onRevoked: () => {},
    })

    expect(connection.isRevoked()).toBe(true)
  })
})
