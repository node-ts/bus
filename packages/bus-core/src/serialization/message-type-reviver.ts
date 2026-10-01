import {
  MessageFieldType,
  MessageTypeDefinition,
  MessageTypes
} from '@node-ts/bus-messages'
import { MessageTypeReferenceNotFound } from './error'

type PlainObject = { [key: string]: unknown }

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Restores parsed JSON to the runtime types described by generated `MessageTypes`
 */
export class MessageTypeReviver {
  /**
   * @param messageTypes the generated message types
   * @throws MessageTypeReferenceNotFound if the message types refer to a type they don't define
   */
  constructor(private readonly messageTypes: MessageTypes) {
    assertReferencesExist(messageTypes)
  }

  /**
   * Checks whether there's an entry for a message or workflow state
   * @param name the `$name` of the message or workflow state
   * @returns true if there's an entry for it
   */
  has(name: string): boolean {
    return Object.hasOwn(this.messageTypes.messages, name)
  }

  /**
   * Restores a parsed message or workflow state. Objects are created from their class' prototype and
   * the parsed fields are copied on, so constructors aren't run.
   * @param plain the parsed message or workflow state
   * @param prototype the prototype of the top-level object
   * @returns the restored object
   */
  revive<T extends object>(plain: object, prototype: object): T {
    const name = (plain as { $name?: unknown }).$name
    const definition =
      typeof name === 'string' && this.has(name)
        ? this.messageTypes.types[this.messageTypes.messages[name]]
        : undefined
    return reviveObject(
      plain as PlainObject,
      definition,
      prototype,
      this.messageTypes
    ) as T
  }
}

const reviveObject = (
  plain: PlainObject,
  definition: MessageTypeDefinition | undefined,
  prototype: object,
  messageTypes: MessageTypes
): object => {
  const revived = Object.create(prototype) as PlainObject
  for (const [key, value] of Object.entries(plain)) {
    const hasFieldType = definition && Object.hasOwn(definition.fields, key)
    // defineProperty rather than assignment, so a `__proto__` key or a getter on the prototype
    // can't change or reject the copy
    Object.defineProperty(revived, key, {
      value: hasFieldType
        ? reviveValue(value, definition.fields[key], messageTypes)
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
  messageTypes: MessageTypes
): unknown => {
  if (value === null || value === undefined) {
    return value
  }
  if (fieldType === 'Date') {
    return value instanceof Date || !isDateSource(value)
      ? value
      : new Date(value)
  }
  if (fieldType === 'BigInt') {
    return typeof value === 'string' || typeof value === 'number'
      ? BigInt(value)
      : value
  }
  if ('type' in fieldType) {
    const definition = messageTypes.types[fieldType.type]
    return isPlainObject(value)
      ? reviveObject(
          value,
          definition,
          definition.class?.prototype ?? Object.prototype,
          messageTypes
        )
      : value
  }
  if ('array' in fieldType) {
    return Array.isArray(value)
      ? value.map(item => reviveValue(item, fieldType.array, messageTypes))
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
        : value.map(item => reviveValue(item, itemType, messageTypes))
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
        valueType === 'plain'
          ? item
          : reviveValue(item, valueType, messageTypes)
      ])
    )
  }
  return isPlainObject(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          reviveValue(item, fieldType.record, messageTypes)
        ])
      )
    : value
}

const isDateSource = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number'

const assertReferencesExist = (messageTypes: MessageTypes): void => {
  const assertExists = (typeKey: string, referencedFrom: string) => {
    if (!Object.hasOwn(messageTypes.types, typeKey)) {
      throw new MessageTypeReferenceNotFound(typeKey, referencedFrom)
    }
  }
  const assertFieldType = (
    fieldType: MessageFieldType | 'plain',
    referencedFrom: string
  ): void => {
    if (typeof fieldType === 'string') {
      return
    }
    if ('type' in fieldType) {
      assertExists(fieldType.type, referencedFrom)
    } else if ('array' in fieldType) {
      assertFieldType(fieldType.array, referencedFrom)
    } else if ('set' in fieldType) {
      assertFieldType(fieldType.set, referencedFrom)
    } else if ('map' in fieldType) {
      assertFieldType(fieldType.map, referencedFrom)
    } else {
      assertFieldType(fieldType.record, referencedFrom)
    }
  }

  for (const [name, typeKey] of Object.entries(messageTypes.messages)) {
    assertExists(typeKey, name)
  }
  for (const [typeKey, definition] of Object.entries(messageTypes.types)) {
    for (const [field, fieldType] of Object.entries(definition.fields)) {
      assertFieldType(fieldType, `${typeKey}.${field}`)
    }
  }
}
