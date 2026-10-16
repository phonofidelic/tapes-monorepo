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
})
