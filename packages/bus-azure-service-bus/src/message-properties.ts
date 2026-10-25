import type {
  ServiceBusMessage,
  ServiceBusReceivedMessage
} from '@azure/service-bus'
import {
  FAILURE_HEADER,
  TransportHeaderReserved,
  TransportHeaders
} from '@node-ts/bus-core'
import { MessageAttributeMap, MessageAttributes } from '@node-ts/bus-messages'

/**
 * The application properties of a Service Bus message
 */
export type ApplicationProperties = NonNullable<
  ServiceBusMessage['applicationProperties']
>

/**
 * The application property holding the bus' `messageId`. The native message id is the bus' id for a message as it
 * was sent, but each retry is a copy with its own native id, so the bus' id travels in a property too.
 */
export const MESSAGE_ID_PROPERTY = 'messageId'

/**
 * The application property holding the time the message was sent, as an ISO 8601 string
 */
export const SENT_AT_PROPERTY = 'sentAt'

/**
 * The application property holding how many times handling the message has failed, set on each retry copy
 */
export const FAILED_ATTEMPTS_PROPERTY = 'failedAttempts'

const ATTRIBUTES_PREFIX = 'attributes.'
const STICKY_ATTRIBUTES_PREFIX = 'stickyAttributes.'

/**
 * The application properties Service Bus writes itself on a message it dead-letters
 */
const DEAD_LETTER_PROPERTIES = [
  'DeadLetterReason',
  'DeadLetterErrorDescription'
]

/**
 * The application property names the transport or Service Bus write themselves, which outgoing middleware can't set
 * as headers. `bus-failure` is written on dead-lettered messages.
 */
const RESERVED_HEADERS = new Set([
  MESSAGE_ID_PROPERTY,
  SENT_AT_PROPERTY,
  FAILED_ATTEMPTS_PROPERTY,
  FAILURE_HEADER,
  ...DEAD_LETTER_PROPERTIES
])

/**
 * Checks that no header set by outgoing middleware has a name the transport or Service Bus writes application
 * properties under
 * @param headers the headers set by outgoing middleware
 * @throws TransportHeaderReserved if a header is named `messageId`, `sentAt`, `failedAttempts`, `bus-failure`,
 * `DeadLetterReason` or `DeadLetterErrorDescription`, or starts with `attributes.` or `stickyAttributes.`
 */
export const assertHeadersNotReserved = (headers: TransportHeaders): void => {
  const reservedHeader = Object.keys(headers).find(
    name =>
      RESERVED_HEADERS.has(name) ||
      name.startsWith(ATTRIBUTES_PREFIX) ||
      name.startsWith(STICKY_ATTRIBUTES_PREFIX)
  )
  if (reservedHeader) {
    throw new TransportHeaderReserved(
      reservedHeader,
      'AzureServiceBusTransport'
    )
  }
}

/**
 * Converts the attributes of a message and the headers set by outgoing middleware to Service Bus application
 * properties: each header under its own name, then `attributes.<key>`, `stickyAttributes.<key>`, `messageId` and
 * `sentAt`. Strings, numbers and booleans keep their types; `undefined` values are left out. `correlationId` and
 * `replyTo` are native message fields, so they aren't properties.
 * @param messageAttributes the attributes of the message being sent
 * @param headers the headers set by outgoing middleware
 * @throws TransportHeaderReserved if a header has a name the transport writes itself
 */
export const toApplicationProperties = (
  messageAttributes: MessageAttributes,
  headers: TransportHeaders
): ApplicationProperties => {
  assertHeadersNotReserved(headers)
  const properties: ApplicationProperties = { ...headers }
  const addAttributes = (
    prefix: string,
    attributes: MessageAttributeMap | undefined
  ) =>
    Object.entries(attributes ?? {}).forEach(([key, value]) => {
      if (value !== undefined) {
        properties[`${prefix}${key}`] = value
      }
    })
  addAttributes(ATTRIBUTES_PREFIX, messageAttributes.attributes)
  addAttributes(STICKY_ATTRIBUTES_PREFIX, messageAttributes.stickyAttributes)
  if (messageAttributes.messageId) {
    properties[MESSAGE_ID_PROPERTY] = messageAttributes.messageId
  }
  if (messageAttributes.sentAt) {
    properties[SENT_AT_PROPERTY] = messageAttributes.sentAt
  }
  return properties
}

/**
 * Reads an application property value back as an attribute value. Dates, which other senders may write, become
 * ISO 8601 strings, or numbers when the client has already converted them to milliseconds since the epoch.
 */
const toAttributeValue = (
  value: ApplicationProperties[string]
): string | number | boolean | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return value
}

/**
 * Reads the bus' attributes of a received message from its native fields and application properties
 * @param message the message as Service Bus delivered it
 */
export const toMessageAttributes = (
  message: Pick<
    ServiceBusReceivedMessage,
    'applicationProperties' | 'correlationId' | 'replyTo'
  >
): MessageAttributes => {
  const properties = message.applicationProperties ?? {}
  const attributes: MessageAttributeMap = {}
  const stickyAttributes: MessageAttributeMap = {}
  Object.entries(properties).forEach(([name, value]) => {
    if (name.startsWith(ATTRIBUTES_PREFIX)) {
      attributes[name.slice(ATTRIBUTES_PREFIX.length)] = toAttributeValue(value)
    } else if (name.startsWith(STICKY_ATTRIBUTES_PREFIX)) {
      stickyAttributes[name.slice(STICKY_ATTRIBUTES_PREFIX.length)] =
        toAttributeValue(value)
    }
  })
  const messageAttributes: MessageAttributes = { attributes, stickyAttributes }
  if (message.correlationId !== undefined && message.correlationId !== null) {
    messageAttributes.correlationId = message.correlationId.toString()
  }
  if (message.replyTo) {
    messageAttributes.replyTo = message.replyTo
  }
  const messageId = properties[MESSAGE_ID_PROPERTY]
  if (typeof messageId === 'string') {
    messageAttributes.messageId = messageId
  }
  const sentAt = toAttributeValue(properties[SENT_AT_PROPERTY])
  if (typeof sentAt === 'string') {
    messageAttributes.sentAt = sentAt
  }
  return messageAttributes
}

/**
 * Reads how many times handling a received message has failed from its `failedAttempts` application property,
 * which each retry copy carries. Service Bus' own delivery count isn't used, since a message that's released at
 * shutdown is delivered again without having failed.
 * @param message the message as Service Bus delivered it
 * @returns the count, or 0 for a message that hasn't been retried
 */
export const toFailedAttempts = (
  message: Pick<ServiceBusReceivedMessage, 'applicationProperties'>
): number => {
  const failedAttempts = Number(
    message.applicationProperties?.[FAILED_ATTEMPTS_PROPERTY]
  )
  return Number.isInteger(failedAttempts) && failedAttempts > 0
    ? failedAttempts
    : 0
}
