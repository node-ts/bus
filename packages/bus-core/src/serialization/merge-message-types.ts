import { MessageTypeDefinition, MessageTypes } from '@node-ts/bus-messages'
import { MessageTypesConflict } from './error'

const isSameDefinition = (
  a: MessageTypeDefinition,
  b: MessageTypeDefinition
): boolean =>
  a.class === b.class && JSON.stringify(a.fields) === JSON.stringify(b.fields)

/**
 * Merges the message types of several message libraries. The same entry registered twice, e.g. by
 * two libraries that share a dependency, is allowed.
 * @param messageTypesList the message types to merge
 * @returns the merged message types
 * @throws MessageTypesConflict if a `$name` or type key is defined differently
 */
export const mergeMessageTypes = (
  messageTypesList: MessageTypes[]
): MessageTypes => {
  const merged: MessageTypes = { messages: {}, types: {} }
  for (const messageTypes of messageTypesList) {
    for (const [name, typeKey] of Object.entries(messageTypes.messages)) {
      if (
        Object.hasOwn(merged.messages, name) &&
        merged.messages[name] !== typeKey
      ) {
        throw new MessageTypesConflict('$name', name)
      }
      merged.messages[name] = typeKey
    }
    for (const [typeKey, definition] of Object.entries(messageTypes.types)) {
      if (
        Object.hasOwn(merged.types, typeKey) &&
        !isSameDefinition(merged.types[typeKey], definition)
      ) {
        throw new MessageTypesConflict('type', typeKey)
      }
      merged.types[typeKey] = definition
    }
  }
  return merged
}
