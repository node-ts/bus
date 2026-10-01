import {
  MessageFieldType,
  MessageTypeDefinition,
  MessageTypes
} from '@node-ts/bus-messages'

type PlainObject = { [key: string]: unknown }

/**
 * How many nested values deep types are restored. Anything deeper is left as JSON parsed it, so a
 * deeply nested payload can't overflow the stack.
 */
export const MAX_REVIVE_DEPTH = 500

const INTEGER = /^-?\d+$/

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Restores parsed JSON to the runtime types described by generated `MessageTypes`. It never throws on
 * a payload: a value that doesn't match its type, such as an invalid Date or bigint, is left as parsed.
 */
export class MessageTypeReviver {
  /**
   * @param getMessageTypes gets the message types to restore with, which are read on every call so
   * types registered later are used too
   */
  constructor(private readonly getMessageTypes: () => MessageTypes) {}

  /**
   * Restores a parsed message or workflow state. Objects are created from their class' prototype and
   * the parsed fields are copied on, so constructors aren't run.
   * @param plain the parsed message or workflow state
   * @param prototype the prototype of the top-level object
   * @returns the restored object
   */
  revive<T extends object>(plain: object, prototype: object): T {
    const messageTypes = this.getMessageTypes()
    const name = (plain as { $name?: unknown }).$name
    const definition =
      typeof name === 'string' && Object.hasOwn(messageTypes.messages, name)
        ? messageTypes.types[messageTypes.messages[name]]
        : undefined
    return reviveObject(
      plain as PlainObject,
      definition,
      prototype,
      messageTypes,
      0
    ) as T
  }
}

const reviveObject = (
  plain: PlainObject,
  definition: MessageTypeDefinition | undefined,
  prototype: object,
  messageTypes: MessageTypes,
  depth: number
): object => {
  const revived = Object.create(prototype) as PlainObject
  for (const [key, value] of Object.entries(plain)) {
    const hasFieldType = definition && Object.hasOwn(definition.fields, key)
    // defineProperty rather than assignment, so a `__proto__` key or a getter on the prototype
    // can't change or reject the copy
    Object.defineProperty(revived, key, {
      value: hasFieldType
        ? reviveValue(value, definition.fields[key], messageTypes, depth + 1)
        : value,
      writable: true,
      enumerable: true,
      configurable: true
    })
  }
  return revived
}

const reviveValue = (
  value: unknown,
  fieldType: MessageFieldType,
  messageTypes: MessageTypes,
  depth: number
): unknown => {
  if (value === null || value === undefined || depth > MAX_REVIVE_DEPTH) {
    return value
  }
  const reviveItem = (item: unknown, itemType: MessageFieldType) =>
    reviveValue(item, itemType, messageTypes, depth + 1)
  if (fieldType === 'Date') {
    return value instanceof Date || !isDateSource(value)
      ? value
      : new Date(value)
  }
  if (fieldType === 'BigInt') {
    const isInteger =
      (typeof value === 'string' && INTEGER.test(value)) ||
      (typeof value === 'number' && Number.isSafeInteger(value))
    return isInteger ? BigInt(value) : value
  }
  if ('type' in fieldType) {
    const definition = messageTypes.types[fieldType.type]
    return isPlainObject(value)
      ? reviveObject(
          value,
          definition,
          definition.class?.prototype ?? Object.prototype,
          messageTypes,
          depth
        )
      : value
  }
  if ('array' in fieldType) {
    return Array.isArray(value)
      ? value.map(item => reviveItem(item, fieldType.array))
      : value
  }
  if ('set' in fieldType) {
    if (!Array.isArray(value)) {
      return value
    }
    const itemType = fieldType.set
    return new Set(
      itemType === 'plain'
        ? value
        : value.map(item => reviveItem(item, itemType))
    )
  }
  if ('map' in fieldType) {
    if (!isPlainObject(value)) {
      return value
    }
    const valueType = fieldType.map
    return new Map(
      Object.entries(value).map(([key, item]) => [
        fieldType.keys === 'number' ? Number(key) : key,
        valueType === 'plain' ? item : reviveItem(item, valueType)
      ])
    )
  }
  return isPlainObject(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          reviveItem(item, fieldType.record)
        ])
      )
    : value
}

const isDateSource = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number'
