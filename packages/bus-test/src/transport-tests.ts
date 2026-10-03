import {
  Bus,
  BusInstance,
  defaultRecoverability,
  handlerFor,
  MessageFailure,
  sleep,
  Transport
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import {
  HandleChecker,
  messageTypes,
  TestCommand,
  TestEvent,
  TestFailMessage,
  TestPoisonedMessage,
  TestUnrecoverableError,
  TestUnrecoverableMessage
} from './helpers'
import { TestSystemMessage } from './helpers/test-system-message'
import {
  messageRoundTripCases,
  RoundTripReceiver
} from './message-round-trip-cases'

const RETRY_DELAY = 5
/**
 * How long to wait for a message that should have been removed from the queue to come back
 */
const SETTLE_WAIT_MS = 1_000
/**
 * How many times the suite's recoverability policy attempts a message before dead-lettering it
 */
const MAX_ATTEMPTS = 5

/**
 * A message read from a transport's dead letter queue
 */
export interface DeadLetteredMessage {
  /**
   * The message that was dead-lettered
   */
  message: Message
  /**
   * The attributes it was sent with
   */
  attributes: MessageAttributes
  /**
   * The failure metadata from its `bus-failure` header, read with `fromFailureHeader()`
   */
  failure: MessageFailure | undefined
}

/**
 * A suite of tests that get wrapped by the integration test setup/tear-down of an
 * implementation of a transport. The suite sends messages with nested types (Dates, class
 * instances, arrays, Maps, Sets, optional and null fields) and checks they arrive with their
 * types restored, so the transport must (de)serialize messages through
 * `coreDependencies.messageSerializer`.
 * @param transport A fully configured transport that's the subject under test
 * @param publishSystemMessage A callback that will publish a `@node-ts/bus-test:TestSystemMessage`
 * with a `systemMessage` attribute set to the value of the `testSystemAttributeValue` parameter
 * @param systemMessageTopicIdentifier An optional system message topic identifier that identifies
 * the source topic of the system message
 * @param readAllFromDeadLetterQueue A callback that waits for a message to be dead-lettered, then reads and deletes
 * all messages on the dead letter queue, with the failure metadata in each one's `bus-failure` header
 */
export const transportTests = (
  transport: Transport,
  publishSystemMessage: (testSystemAttributeValue: string) => Promise<void>,
  systemMessageTopicIdentifier: string | undefined,
  readAllFromDeadLetterQueue: () => Promise<DeadLetteredMessage[]>
): void => {
  const testCommandHandlerEmitter = new EventEmitter()
  const testEventHandlerEmitter = new EventEmitter()
  const testPoisonedMessageHandlerEmitter = new EventEmitter()
  const testSystemMessageHandlerEmitter = new EventEmitter()
  const handleChecker = Mock.ofType<HandleChecker>()
  const roundTripReceiver = new RoundTripReceiver()
  let poisonedMessageReceiptAttempts = 0
  const poisonedMessageAttemptAttributes: MessageAttributes[] = []
  const poisonedMessageFailedAttempts: number[] = []
  let unrecoverableMessageReceiptAttempts = 0
  let failMessageReceiptAttempts = 0
  let bus: BusInstance

  describe('when the transport has been initialized', () => {
    beforeAll(async () => {
      // With the fixtures' generated message types, this checks the transport (de)serializes through the
      // bus' serializer, so nested types survive the round trip
      bus = roundTripReceiver
        .withHandlers(Bus.configure())
        .withMessageTypes(messageTypes)
        .withTransport(transport)
        .withHandler(
          handlerFor(TestCommand, (message, attributes) => {
            handleChecker.object.check(message, attributes)
            testCommandHandlerEmitter.emit('received')
          })
        )
        .withHandler(
          handlerFor(TestEvent, (message, attributes) => {
            handleChecker.object.check(message, attributes)
            testEventHandlerEmitter.emit('received')
          })
        )
        .withHandler(
          handlerFor(TestPoisonedMessage, async (_, attributes) => {
            poisonedMessageAttemptAttributes.push(attributes)
            poisonedMessageFailedAttempts.push(
              bus.getHandlingContext()!.failedAttempts
            )
            poisonedMessageReceiptAttempts++
            testPoisonedMessageHandlerEmitter.emit(
              'received',
              poisonedMessageReceiptAttempts
            )
            throw new Error()
          })
        )
        .withCustomHandler(
          async (message, attributes) => {
            handleChecker.object.check(message, attributes)
            testSystemMessageHandlerEmitter.emit('event')
          },
          {
            resolveWith: (m: TestSystemMessage) =>
              m.$name === TestSystemMessage.NAME,
            topicIdentifier: systemMessageTopicIdentifier
          }
        )
        .withHandler(
          handlerFor(TestFailMessage, async () => {
            failMessageReceiptAttempts++
            await bus.failMessage()
          })
        )
        .withHandler(
          handlerFor(TestUnrecoverableMessage, async message => {
            unrecoverableMessageReceiptAttempts++
            throw new TestUnrecoverableError(message.id)
          })
        )
        .withRecoverability(
          defaultRecoverability({
            maxAttempts: MAX_ATTEMPTS,
            delay: RETRY_DELAY,
            unrecoverable: [TestUnrecoverableError]
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
    })

    afterAll(async () => bus.dispose())

    describe('when a system message is received', () => {
      const attrValue = randomUUID()

      it('should handle the system message', async () => {
        const messageHandled = new Promise<void>(resolve =>
          testSystemMessageHandlerEmitter.on('event', resolve)
        )
        await publishSystemMessage(attrValue)
        await messageHandled
        handleChecker.verify(
          h =>
            h.check(
              It.isAny(),
              It.isObjectWith<MessageAttributes>({
                attributes: { systemMessage: attrValue }
              })
            ),
          Times.once()
        )
      })
    })

    describe('when sending a command', () => {
      const testCommand = new TestCommand(randomUUID(), new Date())
      const messageOptions: MessageAttributes = {
        correlationId: randomUUID(),
        messageId: randomUUID(),
        attributes: {
          attribute1: 'a',
          attribute2: 1
        },
        stickyAttributes: {
          attribute1: 'b',
          attribute2: 2
        }
      }

      beforeAll(async () => {
        const messageHandled = new Promise(resolve =>
          testCommandHandlerEmitter.once('received', resolve)
        )
        await bus.send(testCommand, messageOptions)
        await messageHandled
      })

      it('should receive and dispatch to the handler', () => {
        handleChecker.verify(
          h =>
            h.check(
              It.isAny(),
              It.isObjectWith<MessageAttributes>(messageOptions)
            ),
          Times.once()
        )
      })

      it('should keep the messageId given by the caller', () => {
        handleChecker.verify(
          h =>
            h.check(
              It.isAny(),
              It.is<MessageAttributes>(
                attributes => attributes.messageId === messageOptions.messageId
              )
            ),
          Times.once()
        )
      })

      it('should deserialize the command as a class instance with its nested types', () => {
        handleChecker.verify(
          h =>
            h.check(
              It.is<TestCommand>(
                message =>
                  message instanceof TestCommand &&
                  message.value === testCommand.value &&
                  message.date instanceof Date &&
                  message.date.getTime() === testCommand.date.getTime()
              ),
              It.isAny()
            ),
          Times.once()
        )
      })
    })

    messageRoundTripCases(() => bus, roundTripReceiver)

    describe('when publishing an event', () => {
      const testEvent = new TestEvent()
      const messageOptions: MessageAttributes = {
        correlationId: randomUUID(),
        attributes: {
          foo: 'bar'
        },
        stickyAttributes: {}
      }

      beforeAll(async () => {
        const messageHandled = new Promise(resolve =>
          testEventHandlerEmitter.once('received', resolve)
        )
        await bus.publish(testEvent, messageOptions)
        await messageHandled
      })

      it('should receive and dispatch to the handler', () => {
        handleChecker.verify(
          h =>
            h.check(
              It.isAnyObject(TestEvent),
              It.isObjectWith<MessageAttributes>(messageOptions)
            ),
          Times.once()
        )
      })

      it('should arrive with the messageId and sentAt stamped by the bus', () => {
        handleChecker.verify(
          h =>
            h.check(
              It.isAnyObject(TestEvent),
              It.is<MessageAttributes>(
                attributes =>
                  attributes.correlationId === messageOptions.correlationId &&
                  typeof attributes.messageId === 'string' &&
                  attributes.messageId.length > 0 &&
                  typeof attributes.sentAt === 'string' &&
                  new Date(attributes.sentAt).toISOString() ===
                    attributes.sentAt
              )
            ),
          Times.once()
        )
      })
    })

    describe('when handing a poisoned message', () => {
      const poisonedMessage = new TestPoisonedMessage(randomUUID())
      let deadMessages: DeadLetteredMessage[]

      beforeAll(async () => {
        const messageHandled = new Promise<void>(resolve => {
          testPoisonedMessageHandlerEmitter.on('received', attempts => {
            if (attempts >= MAX_ATTEMPTS) {
              resolve()
            }
          })
        })
        await bus.publish(poisonedMessage)
        await messageHandled

        deadMessages = await readAllFromDeadLetterQueue()
      })

      it('should retry processing of the message then fail to the dead letter queue', () => {
        expect(deadMessages).toHaveLength(1)
        const [deadMessage] = deadMessages
        expect(deadMessage.message).toMatchObject(poisonedMessage)
      })

      it('should count the failed attempts up on each delivery', () => {
        expect(poisonedMessageFailedAttempts).toEqual(
          Array.from({ length: MAX_ATTEMPTS }, (_, attempt) => attempt)
        )
      })

      it('should dead-letter it once it has been attempted maxAttempts times', () => {
        expect(poisonedMessageReceiptAttempts).toEqual(MAX_ATTEMPTS)
      })

      it('should add the failure metadata to the dead-lettered message', () => {
        const [firstAttempt] = poisonedMessageAttemptAttributes
        const [{ failure }] = deadMessages
        expect(failure).toMatchObject({
          error: { name: 'Error' },
          failedAttempts: MAX_ATTEMPTS,
          endpoint: transport.endpointName,
          messageId: firstAttempt.messageId
        })
        expect(new Date(failure!.failedAt).toISOString()).toEqual(
          failure!.failedAt
        )
      })

      it('should keep the messageId and sentAt across retries', () => {
        const [firstAttempt] = poisonedMessageAttemptAttributes
        expect(firstAttempt.messageId).toBeDefined()
        expect(firstAttempt.sentAt).toBeDefined()
        poisonedMessageAttemptAttributes.forEach(attempt => {
          expect(attempt.messageId).toEqual(firstAttempt.messageId)
          expect(attempt.sentAt).toEqual(firstAttempt.sentAt)
        })
      })

      it('should keep the messageId and sentAt in the dead letter queue', () => {
        const [firstAttempt] = poisonedMessageAttemptAttributes
        const [deadMessage] = deadMessages
        expect(deadMessage.attributes.messageId).toEqual(firstAttempt.messageId)
        expect(deadMessage.attributes.sentAt).toEqual(firstAttempt.sentAt)
      })
    })

    describe('when a message fails with an unrecoverable error', () => {
      const unrecoverableMessage = new TestUnrecoverableMessage(randomUUID())
      let deadMessages: DeadLetteredMessage[]

      beforeAll(async () => {
        await bus.publish(unrecoverableMessage)
        deadMessages = await readAllFromDeadLetterQueue()
      })

      it('should dead-letter it on its first failure', () => {
        expect(unrecoverableMessageReceiptAttempts).toEqual(1)
        expect(deadMessages).toHaveLength(1)
        expect(deadMessages[0].message).toMatchObject(unrecoverableMessage)
      })

      it('should add the error to the failure metadata', () => {
        expect(deadMessages[0].failure).toMatchObject({
          error: {
            name: 'TestUnrecoverableError',
            message: `Message ${unrecoverableMessage.id} can never be handled`
          },
          failedAttempts: 1,
          endpoint: transport.endpointName
        })
        expect(deadMessages[0].failure!.error.stack).toContain(
          'TestUnrecoverableError'
        )
      })
    })

    describe('when failing a message', () => {
      const messageToFail = new TestFailMessage(randomUUID())
      const correlationId = randomUUID()
      const messageId = randomUUID()
      const sentAt = new Date().toISOString()
      let deadLetterQueueMessages: DeadLetteredMessage[]

      beforeAll(async () => {
        await bus.publish(messageToFail, { correlationId, messageId, sentAt })
        deadLetterQueueMessages = await readAllFromDeadLetterQueue()

        // A message that fail() left unsettled would be redelivered, or hold up the queue behind it
        const nextMessageHandled = new Promise(resolve =>
          testCommandHandlerEmitter.once('received', resolve)
        )
        await bus.send(new TestCommand(randomUUID(), new Date()))
        await nextMessageHandled
        await sleep(SETTLE_WAIT_MS)
      })

      it('should remove it from the service queue', () => {
        expect(failMessageReceiptAttempts).toEqual(1)
      })

      it('should forward it to the dead letter queue', () => {
        const deadLetterMessage = deadLetterQueueMessages.find(
          msg => msg.message.$name === messageToFail.$name
        )
        expect(deadLetterMessage).toBeDefined()
        expect(deadLetterMessage!.message).toMatchObject(messageToFail)
      })

      it('should only have received the message once', () => {
        const receiveCount = deadLetterQueueMessages.filter(
          msg => msg.message.$name === messageToFail.$name
        ).length
        expect(receiveCount).toEqual(1)
      })

      it('should retain the same message attributes', () => {
        const deadLetterMessage = deadLetterQueueMessages.find(
          msg => msg.message.$name === messageToFail.$name
        )
        expect(deadLetterMessage?.attributes).toMatchObject({
          correlationId,
          messageId,
          sentAt
        })
      })

      it('should add the failure metadata to the dead-lettered message', () => {
        const deadLetterMessage = deadLetterQueueMessages.find(
          msg => msg.message.$name === messageToFail.$name
        )
        expect(deadLetterMessage?.failure).toMatchObject({
          error: { name: 'FailMessageRequested' },
          failedAttempts: 1,
          endpoint: transport.endpointName,
          messageId
        })
      })
    })
  })
}
