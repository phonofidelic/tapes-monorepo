/**
 * Narrows a caught value to an Error, so a handler can put it in the failure
 * branch of a response. A `catch` binding is `unknown`, and a channel that
 * answers with a union has to hand the renderer an Error either way.
 */
export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
