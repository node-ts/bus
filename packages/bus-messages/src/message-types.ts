/**
 * How a field is restored after its message has been parsed from JSON. Fields that JSON already
 * represents (strings, numbers, booleans, null, plain objects and arrays of them) aren't listed.
 *
 * - `'Date'`: an ISO string or epoch number becomes a `Date`
 * - `'BigInt'`: a string or number becomes a `bigint`
 * - `{ type }`: an object is restored using the entry with that key in `MessageTypes.types`
 * - `{ array }`: each item of an array is restored as the given type
 * - `{ set }`: an array becomes a `Set`, with each item restored as the given type, or kept as-is for `'plain'`
 * - `{ map }`: an object becomes a `Map` of its entries, with each value restored as the given type, or kept
 * as-is for `'plain'`. Keys stay strings unless `keys` is `'number'`
 * - `{ record }`: each value of an object used as a dictionary is restored as the given type
 */
export type MessageFieldType =
  | 'Date'
  | 'BigInt'
  | { type: string }
  | { array: MessageFieldType }
  | { set: MessageFieldType | 'plain' }
  | { map: MessageFieldType | 'plain'; keys?: 'number' }
  | { record: MessageFieldType }

/**
 * How to restore one class or object type
 */
export interface MessageTypeDefinition {
  /**
   * The class restored objects are created from. They get its prototype, so `instanceof`, getters and
   * methods work, but its constructor isn't run. Object types such as interfaces have no class and are
   * restored as plain objects.
   */
  class?: new (...args: any[]) => object

  /**
   * The fields that need restoring, by name. Fields that aren't listed are kept as they were parsed.
   */
  fields: { [field: string]: MessageFieldType }
}

/**
 * The runtime types of messages and workflow state, generated from their TypeScript source by
 * `bus generate-message-types` in `@node-ts/bus-cli`. Pass it to `withMessageTypes()` when configuring
 * the bus so that the default serializer restores Dates, Maps, Sets, BigInts and class instances at
 * any depth.
 */
export interface MessageTypes {
  /**
   * Maps the `$name` of each message and workflow state to the key of its entry in `types`
   */
  messages: { [$name: string]: string }

  /**
   * How to restore each class or object type, by key
   */
  types: { [key: string]: MessageTypeDefinition }
}
