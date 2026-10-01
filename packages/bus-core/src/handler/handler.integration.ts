import { MessageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'stream'
import { It, Mock, Times } from 'typemoq'
import { Bus, BusInstance } from '../service-bus'
import {
  MessageLogger,
  randomInt,
  TestCommand2,
  testEventHandler,
  testMessageTypes
} from '../test'
import { TestCommand } from '../test/test-command'
import { TestCommand3 } from '../test/test-command-3'
import { TestCommandGetterClassHandler } from '../test/test-command-getter-class-handler'
import { TestEvent } from '../test/test-event'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { ClassConstructor, sleep } from '../util'
import { handlerFor } from './handler-for'

const event = new TestEvent()
const command = new TestCommand()

const attributes: MessageAttributes = {
  correlationId: randomUUID(),
  attributes: {
    one: 1
  },
  stickyAttributes: {
    a: 'a'
  }
}

describe('Handler', () => {
  describe('for a correctly configured instance', () => {
    const messageLogger = Mock.ofType<MessageLogger>()
    const events = new EventEmitter()
    let bus: BusInstance

    // Sticky attributes should propagate during Bus.send
    const command2Handler = handlerFor(
      TestCommand2,
      async (_: TestCommand2, { correlationId }) => {
        await bus.send(new TestCommand3())
        messageLogger.object.log({ name: 'command2Handler', correlationId })
        events.emit('command2Handler')
      }
    )
    const command3Handler = (messageLogger: MessageLogger) =>
      handlerFor(
        TestCommand3,
        async (
          _: TestCommand3,
          { stickyAttributes, correlationId }: MessageAttributes
        ) => {
          messageLogger.log(stickyAttributes.value)
          messageLogger.log({ name: 'command3Handler', correlationId })
          events.emit('command3Handler')
        }
      )

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withConcurrency(2)
        .withContainer({
          get<T>(type: ClassConstructor<T>) {
            return new type(messageLogger.object)
          }
        })
        .withHandler(testEventHandler(messageLogger.object))
        .withHandler(TestEventClassHandler)
        .withHandler(command2Handler)
        .withHandler(command3Handler(messageLogger.object))
        .build()

      await bus.initialize()
      await bus.start()
      await bus.publish(event)
      await bus.publish(event, attributes)
      await bus.send(command)

      await sleep(1)
    })

    afterAll(async () => bus.dispose())

    describe('when a handled message is received', () => {
      it('should dispatch to the registered handler', () => {
        const numHandlersForMessage = 2
        const numTimesMessagePublished = 2
        messageLogger.verify(
          m => m.log(event),
          Times.exactly(numHandlersForMessage * numTimesMessagePublished)
        )
      })
    })

    describe('when a handled message is received with attributes', () => {
      it('should receive the attributes', () => {
        const numHandlersForMessage = 2
        messageLogger.verify(
          m => m.log(It.isObjectWith(attributes)),
          Times.exactly(numHandlersForMessage)
        )
      })
    })

    describe('when a handled message is received with sticky attributes', () => {
      it('should propagate sticky attributes', async () => {
        const command2 = new TestCommand2()
        const attributes1: Partial<MessageAttributes> = {
          stickyAttributes: {
            value: randomInt()
          }
        }
        const attributes2: Partial<MessageAttributes> = {
          stickyAttributes: {
            value: randomInt()
          }
        }
        const messagesHandled = new Promise<void>(resolve => {
          let receiptCount = 0
          events.on('command3Handler', () => {
            if (++receiptCount == 2) {
              resolve()
            }
          })
        })
        await bus.send(command2, attributes1)
        await bus.send(command2, attributes2)
        await messagesHandled

        messageLogger.verify(
          logger => logger.log(attributes1.stickyAttributes!.value),
          Times.once()
        )

        messageLogger.verify(
          logger => logger.log(attributes2.stickyAttributes!.value),
          Times.once()
        )
      })
    })

    describe('when an unhandled message is received', () => {
      it('should not handle the message', () => {
        messageLogger.verify(m => m.log(command), Times.never())
      })
    })

    describe('when sending a message with a correlationId', () => {
      it('should propagate the correlationId over multiple hops', async () => {
        const command2 = new TestCommand2()
        const attributes: Partial<MessageAttributes> = {
          correlationId: randomUUID()
        }
        const messageHandled = new Promise<void>(resolve => {
          events.on('command3Handler', resolve)
        })
        await bus.send(command2, attributes)
        await messageHandled

        messageLogger.verify(
          logger =>
            logger.log(
              It.isObjectWith({
                name: 'command3Handler',
                correlationId: attributes.correlationId
              })
            ),
          Times.once()
        )
      })
    })

    describe('when sending a message without a correlationId', () => {
      let command2CorrelationId: string
      beforeAll(async () => {
        messageLogger.reset()
        messageLogger
          .setup(m =>
            m.log(It.is<any>(m => !!m && m.name === 'command2Handler'))
          )
          .callback(m => (command2CorrelationId = m.correlationId))
        const command2 = new TestCommand2()

        const messageHandled = new Promise<void>(resolve =>
          events.on('command3Handler', resolve)
        )
        await bus.send(command2)
        await messageHandled
      })

      afterAll(() => {
        messageLogger.reset()
      })

      it('should assign a correlationId', () => {
        messageLogger.verify(
          logger =>
            logger.log(
              It.isObjectWith({
                name: 'command3Handler',
                correlationId: command2CorrelationId
              })
            ),
          Times.once()
        )
      })

      it('should propagate the correlationId over multiple hops', () => {
        messageLogger.verify(
          logger =>
            logger.log(
              It.isObjectWith({
                name: 'command3Handler',
                correlationId: command2CorrelationId
              })
            ),
          Times.once()
        )
      })
    })
  })

  describe('when a class handler declares messageType as a getter', () => {
    const messageLogger = Mock.ofType<MessageLogger>()
    const events = new EventEmitter()
    const getterCommand = new TestCommand()
    let bus: BusInstance

    beforeAll(async () => {
      messageLogger
        .setup(m => m.log(getterCommand))
        .callback(() => events.emit('received'))

      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withContainer({
          get<T>(type: ClassConstructor<T>) {
            return new type(messageLogger.object)
          }
        })
        .withHandler(TestCommandGetterClassHandler)
        .build()

      await bus.initialize()
      await bus.start()

      const received = new Promise(resolve => events.once('received', resolve))
      await bus.send(getterCommand)
      await received
    })

    afterAll(async () => bus.dispose())

    it('should only construct the handler through the container', () => {
      messageLogger.verify(
        m => m.log('TestCommandGetterClassHandler constructed'),
        Times.once()
      )
    })

    it('should dispatch the message to the handler', () => {
      messageLogger.verify(m => m.log(getterCommand), Times.once())
    })
  })
})
