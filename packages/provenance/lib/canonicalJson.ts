/**
 * Canonical JSON (RFC 8785), so the same statement serializes to the same bytes
 * on every device and its signature and address stay stable.
 *
 * Only plain JSON data is accepted. Anything JSON.stringify would silently
 * change or drop throws instead, because a signature over a lossy encoding
 * would not verify against the original value.
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Cannot canonicalize ${value}`)
    }
    // RFC 8785 number formatting is ECMAScript's Number-to-string, which is
    // what JSON.stringify uses. It also writes -0 as 0.
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    assertWellFormed(value)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(arrayItem).join(',')}]`
  }
  if (isPlainObject(value)) {
    // Default sort compares UTF-16 code units, which is the order RFC 8785
    // requires.
    const members = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => {
        assertWellFormed(key)
        return `${JSON.stringify(key)}:${canonicalJson(value[key])}`
      })
    return `{${members.join(',')}}`
  }
  throw new TypeError(`Cannot canonicalize a value of type ${typeof value}`)
}

// JSON.stringify writes undefined in an array as null. Optional object fields
// are skipped instead, so a missing field and an undefined one sign the same.
function arrayItem(item: unknown): string {
  if (item === undefined) {
    throw new TypeError('Cannot canonicalize undefined in an array')
  }
  return canonicalJson(item)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// RFC 8785 requires I-JSON, which forbids lone surrogates.
function assertWellFormed(value: string) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
        continue
      }
      throw new TypeError('Cannot canonicalize a string with a lone surrogate')
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Cannot canonicalize a string with a lone surrogate')
    }
  }
}
