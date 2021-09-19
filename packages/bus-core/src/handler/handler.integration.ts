import { TestEvent } from '../test/test-event'
import { Bus, BusInstance } from '../service-bus'
import { MessageAttributes } from '@node-ts/bus-messages'
import { TestCommand } from '../test/test-command'
import { Mock, Times, It } from 'typemoq'
import { ClassConstructor, sleep } from '../util'
import { MessageLogger, TestCommand2, testEventHandler } from '../test'
import * as faker from 'faker'
import { Handler } from './handler'
import { TestCommand3 } from '../test/test-command-3'
import { TestEventClassHandler } from '../test/test-event-class-handler'
import { EventEmitter } from 'stream'

const event = new TestEvent()
const command = new TestCommand()

const attributes: MessageAttributes = {
  correlationId: faker.random.uuid(),
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
    const command2Handler: Handler<TestCommand2> = async (_: TestCommand2, { correlationId }) => {
      await bus.send(new TestCommand3())
      messageLogger.object.log({ name: 'command2Handler', correlationId })
      events.emit('command2Handler')
    }
    const command3Handler = (messageLogger: MessageLogger) => async (_: TestCommand3, { stickyAttributes, correlationId }: MessageAttributes) => {
      messageLogger.log(stickyAttributes.value)
      messageLogger.log({ name: 'command3Handler', correlationId })
      events.emit('command3Handler')
    }

    beforeAll(async () => {
      bus = await Bus.configure()
        .withConcurrency(2)
        .withContainer({
          get<T>(type: ClassConstructor<T>) {
            return new type(messageLogger.object)
          }
        })
        .withHandler(TestEvent, testEventHandler(messageLogger.object))
        .withHandler(TestEvent, TestEventClassHandler)
        .withHandler(TestCommand2, command2Handler)
        .withHandler(TestCommand3, command3Handler(messageLogger.object))
        .initialize()

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
            value: faker.random.number()
          }
        }
        const attributes2: Partial<MessageAttributes> = {
          stickyAttributes: {
            value: faker.random.number()
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
          logger => logger.log(attributes1.stickyAttributes.value),
          Times.once()
        )

        messageLogger.verify(
          logger => logger.log(attributes2.stickyAttributes.value),
          Times.once()
        )
      })
    })

    describe('when an unhandled message is received', () => {
      it('should not handle the message', () => {
        messageLogger.verify(
          m => m.log(command),
          Times.never()
        )
      })
    })

    describe('when sending a message with a correlationId', () => {
      it('should propagate the correlationId over multiple hops', async () => {
        const command2 = new TestCommand2()
        const attributes: Partial<MessageAttributes> = {
          correlationId: faker.random.uuid()
        }
        const messageHandled = new Promise<void>(resolve => {
          events.on('command3Handler', resolve)
        })
        await bus.send(command2, attributes)
        await messageHandled

        messageLogger.verify(
          logger => logger.log(It.isObjectWith({ name: 'command3Handler', correlationId: attributes.correlationId })),
          Times.once()
        )
      })
    })

    describe('when sending a message without a correlationId', () => {
      let command2CorrelationId: string
      beforeAll(async () => {
        messageLogger.reset()
        messageLogger
          .setup(m => m.log(It.is<any>(m => !!m && m.name === 'command2Handler')))
          .callback(m => command2CorrelationId = m.correlationId)
        const command2 = new TestCommand2()

        const messageHandled = new Promise<void>(resolve => events.on('command3Handler', resolve))
        await bus.send(command2)
        await messageHandled
      })

      afterAll(() => {
        messageLogger.reset()
      })

      it('should assign a correlationId', () => {
        messageLogger.verify(
          logger => logger.log(It.isObjectWith({ name: 'command3Handler', correlationId: command2CorrelationId })),
          Times.once()
        )
      })

      it('should propagate the correlationId over multiple hops', () => {
        messageLogger.verify(
          logger => logger.log(It.isObjectWith({ name: 'command3Handler', correlationId: command2CorrelationId })),
          Times.once()
        )
      })
    })
  })
})
