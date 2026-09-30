/**
 * Characters that can't be stored safely in a mongodb field name, and their escapes.
 * `%` is the escape character, so it's escaped too, which keeps the encoding lossless.
 */
const KEY_ESCAPES: Record<string, string> = {
  '%': '%25',
  $: '%24',
  '.': '%2E'
}

const KEY_UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_ESCAPES).map(([character, escape]) => [escape, character])
)

/**
 * Escapes a single key so it can be stored as a mongodb field name
 * @example encodeKey('$workflowId') => '%24workflowId'
 */
export const encodeKey = (key: string): string =>
  key.replace(/[%$.]/g, character => KEY_ESCAPES[character])

/**
 * Reverses `encodeKey`, so that `decodeKey(encodeKey(key)) === key` for every key
 * @example decodeKey('%24workflowId') => '$workflowId'
 */
export const decodeKey = (key: string): string =>
  key.replace(/%(25|24|2E)/g, escape => KEY_UNESCAPES[escape])

/**
 * Encodes every key of a plain object, including keys of nested objects and of
 * objects inside arrays. Other values are returned as-is.
 */
export const encodeKeys = <T>(value: T): T => mapKeysDeep(value, encodeKey)

/**
 * Reverses `encodeKeys`
 */
export const decodeKeys = <T>(value: T): T => mapKeysDeep(value, decodeKey)

const mapKeysDeep = <T>(value: T, mapKey: (key: string) => string): T => {
  if (Array.isArray(value)) {
    return value.map(item => mapKeysDeep(item, mapKey)) as T
  }
  if (!isPlainObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      mapKey(key),
      mapKeysDeep(child, mapKey)
    ])
  ) as T
}

// Leaves values such as Date, ObjectId and Binary alone
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
