import { Bus, BusInstance, handlerFor, Transport } from '@node-ts/bus-core'
import {
  HandleChecker,
  TestCommand,
  TestEvent,
  TestFailMessage,
  TestPoisonedMessage
} from './helpers'
import { EventEmitter } from 'stream'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import * as uuid from 'uuid'
import { Mock, It, Times } from 'typemoq'
import { TestSystemMessage } from './helpers/test-system-message'

const RETRY_DELAY = 5

/**
 * A suite of tests that get wrapped by the integration test setup/tear-down of an
 * implementation of a transport
 * @param transport A fully configured transport that's the subject under test
 * @param publishSystemMessage A callback that will publish a `@node-ts/bus-test:TestSystemMessage`
 * with a `systemMessage` attribute set to the value of the `testSystemAttributeValue` parameter
 * @param systemMessageTopicIdentifier An optional system message topic identifier that identifies
 * the source topic of the system message
 * @param readAllFromDeadLetterQueue A callback that will read and delete all messages on the dead
 * letter queue
 */
export const transportTests = (
  transport: Transport,
  publishSystemMessage: (testSystemAttributeValue: string) => Promise<void>,
  systemMessageTopicIdentifier: string | undefined,
  readAllFromDeadLetterQueue: () => Promise<
    { message: Message; attributes: MessageAttributes }[]
  >
) => {
  const testCommandHandlerEmitter = new EventEmitter()
  const testEventHandlerEmitter = new EventEmitter()
  const testPoisonedMessageHandlerEmitter = new EventEmitter()
  const testSystemMessageHandlerEmitter = new EventEmitter()
  const handleChecker = Mock.ofType<HandleChecker>()
  let poisonedMessageReceiptAttempts = 0
  let bus: BusInstance

  return describe('when the transport has been initialized', () => {
    beforeAll(async () => {
      bus = Bus.configure()
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
          handlerFor(TestPoisonedMessage, async () => {
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
        .withHandler(handlerFor(TestFailMessage, async () => bus.failMessage()))
        .withRetryStrategy({
          calculateRetryDelay(_: number): number {
            return RETRY_DELAY
          }
        })
        .build()

      await bus.initialize()
      await bus.start()
    })

    afterAll(async () => bus.dispose())

    describe('when a system message is received', () => {
      const attrValue = uuid.v4()

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
      const testCommand = new TestCommand(uuid.v4(), new Date())
      const messageOptions: MessageAttributes = {
        correlationId: uuid.v4(),
        attributes: {
          attribute1: 'a',
          attribute2: 1
        },
        stickyAttributes: {
          attribute1: 'b',
          attribute2: 2
        }
      }

      it('should receive and dispatch to the handler', async () => {
        const messageHandled = new Promise(resolve =>
          testCommandHandlerEmitter.on('received', resolve)
        )
        await bus.send(testCommand, messageOptions)
        await messageHandled
        handleChecker.verify(
          h =>
            h.check(
              It.isAny(),
              It.isObjectWith<MessageAttributes>(messageOptions)
            ),
          Times.once()
        )
      })
    })

    describe('when publishing an event', () => {
      const testEvent = new TestEvent()
      const messageOptions: MessageAttributes = {
        correlationId: uuid.v4(),
        attributes: {
          foo: 'bar'
        },
        stickyAttributes: {}
      }

      it('should receive and dispatch to the handler', async () => {
        const messageHandled = new Promise(resolve =>
          testEventHandlerEmitter.on('received', resolve)
        )
        await bus.publish(testEvent, messageOptions)
        await messageHandled
        handleChecker.verify(
          h =>
            h.check(
              It.isAnyObject(TestEvent),
              It.isObjectWith<MessageAttributes>(messageOptions)
            ),
          Times.once()
        )
      })
    })

    describe('when handing a poisoned message', () => {
      const poisonedMessage = new TestPoisonedMessage(uuid.v4())
      let deadMessages: { message: Message; attributes: MessageAttributes }[]

      beforeAll(async () => {
        const messageHandled = new Promise<void>(resolve => {
          testPoisonedMessageHandlerEmitter.on('received', attempts => {
            if (attempts >= 10) {
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
    })

    describe('when failing a message', () => {
      const messageToFail = new TestFailMessage(uuid.v4())
      const correlationId = uuid.v4()
      let deadLetterQueueMessages: {
        message: Message
        attributes: MessageAttributes
      }[]

      beforeAll(async () => {
        await bus.publish(messageToFail, { correlationId })
        deadLetterQueueMessages = await readAllFromDeadLetterQueue()
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
        expect(deadLetterMessage?.attributes.correlationId).toEqual(
          correlationId
        )
      })
    })
  })
}
