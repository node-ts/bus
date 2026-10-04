import { Message, MessageDeclaration } from '@node-ts/bus-messages'
import { DelayedReplyNotSupported, ReturnAddressMissing } from '../error'
import { assertDeliveryOptions } from '../outgoing-message/assert-delivery-options'
import { HandlerContextOverrides } from './handler-context-overrides'
import { RecordedMessages } from './recorded-messages'
import type { RecordingHandlerContext } from './recording-handler-context'
import { TEST_RETURN_ADDRESS } from './test-return-address'
import { Writable } from './writable'

/**
 * How a fake context names the message being handled in a `ReturnAddressMissing` when it isn't told its name
 */
export const UNNAMED_REQUEST = 'the message being handled'

/**
 * Narrows recorded messages to one message type, by its `NAME`
 */
const ofType = <TRecorded extends { message: Message }>(
  recorded: TRecorded[],
  messageType: MessageDeclaration<Message>
): TRecorded[] =>
  recorded.filter(({ message }) => message.$name === messageType.NAME)

/**
 * Adds `sentOf`, `publishedOf` and `repliedOf` to recorded messages. Internal: the test helpers share it.
 * @param recorded the recorded messages
 * @returns the recorded messages with the narrowing functions
 */
export const withTypedAccess = <
  TRecorded extends Pick<RecordedMessages, 'sent' | 'published' | 'replied'>
>(
  recorded: TRecorded
): TRecorded & RecordedMessages =>
  Object.assign(recorded, {
    sentOf: (commandType: MessageDeclaration<Message>) =>
      ofType(recorded.sent, commandType),
    publishedOf: (eventType: MessageDeclaration<Message>) =>
      ofType(recorded.published, eventType),
    repliedOf: (messageType: MessageDeclaration<Message>) =>
      ofType(recorded.replied, messageType)
  }) as TRecorded & RecordedMessages

/**
 * Creates a recording handler context. Internal: `handlerContext()`, `workflowContext()` and `testWorkflow()` share
 * it, and `testWorkflow()` names the message being handled in the errors.
 * @param overrides the members to replace, and the return address of the message being handled
 * @param requestName the `$name` of the message being handled, for `ReturnAddressMissing`
 * @returns a recording handler context
 */
export const createRecordingHandlerContext = (
  overrides: HandlerContextOverrides,
  requestName: string
): RecordingHandlerContext => {
  const { replyTo, ...contextOverrides } = overrides
  const destination = Object.hasOwn(overrides, 'replyTo')
    ? replyTo
    : TEST_RETURN_ADDRESS
  const recorder: Writable<
    Omit<
      RecordingHandlerContext,
      keyof Omit<RecordedMessages, 'sent' | 'published' | 'replied'>
    >
  > = {
    correlationId: undefined,
    sent: [],
    published: [],
    replied: [],
    messageFailed: false,
    messageReturned: false,
    // Checked as the bus checks them, so a test fails on options the bus would reject
    send: async (command, options = {}) => {
      assertDeliveryOptions(command, options)
      recorder.sent.push({ message: command, options })
    },
    publish: async (event, options = {}) => {
      assertDeliveryOptions(event, options)
      recorder.published.push({ message: event, options })
    },
    reply: async (message, messageAttributes = {}) => {
      // Typed out of reply(), but a caller may pass the options it gives send()
      if (
        'deliverAfter' in messageAttributes ||
        'deliverAt' in messageAttributes
      ) {
        throw new DelayedReplyNotSupported(message.$name)
      }
      if (!destination) {
        throw new ReturnAddressMissing(requestName, message.$name)
      }
      recorder.replied.push({
        message,
        options: messageAttributes,
        destination
      })
    },
    failMessage: async () => {
      recorder.messageFailed = true
    },
    returnMessage: async () => {
      recorder.messageReturned = true
    }
  }
  return Object.assign(withTypedAccess(recorder), contextOverrides)
}
