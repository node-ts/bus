import { MessageTypes } from '@node-ts/bus-messages'
import { ClassConstructor } from '../util'
import { MessageTypeReviver } from './message-type-reviver'
import { Serializer } from './serializer'

/**
 * Writes the values JSON can't represent as plain JSON: a Map as an object of its entries, a Set
 * as an array and a bigint as a string. Dates already become ISO strings through `toJSON`.
 */
const toJsonValue = (_: string, value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value instanceof Map) {
    return Object.fromEntries(value)
  }
  if (value instanceof Set) {
    return [...value]
  }
  return value
}

/**
 * The default serializer. Messages and workflow state are written as plain JSON, with Maps as
 * objects, Sets as arrays and bigints as strings, so nothing is added to the payload.
 *
 * When reading, the top-level object is created from its class' prototype, without running its
 * constructor. With generated message types (see `bus generate-message-types` in `@node-ts/bus-cli`),
 * Dates, Maps, Sets, bigints and class instances are restored at any depth too. Without them, nested
 * values stay as JSON parsed them, e.g. Dates stay ISO strings.
 * @example
 * import { messageTypes } from './message-types.generated'
 *
 * const serializer = new JsonSerializer(messageTypes)
 */
export class JsonSerializer implements Serializer {
  private readonly reviver: MessageTypeReviver

  /**
   * @param messageTypes the generated message types used to restore nested types
   * @throws MessageTypeReferenceNotFound if the message types refer to a type they don't define
   */
  constructor(messageTypes?: MessageTypes) {
    this.reviver = new MessageTypeReviver(
      messageTypes ?? { messages: {}, types: {} }
    )
  }

  serialize<ObjectType extends object>(obj: ObjectType): string {
    return JSON.stringify(obj, toJsonValue)
  }

  deserialize<ObjectType extends object>(
    serialized: string,
    classConstructor: ClassConstructor<ObjectType>
  ): ObjectType {
    const plain = JSON.parse(serialized) as object
    return this.toClass(plain, classConstructor)
  }

  toPlain<T extends object>(obj: T): object {
    return JSON.parse(this.serialize(obj)) as object
  }

  toClass<T extends object>(
    obj: object,
    classConstructor: ClassConstructor<T>
  ): T {
    return this.reviver.revive<T>(obj, classConstructor.prototype as object)
  }
}
