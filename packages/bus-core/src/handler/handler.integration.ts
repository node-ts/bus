import { TestEvent } from '../test/test-event'
import { Bus } from '../service-bus'
import { MessageAttributes } from '@node-ts/bus-messages'
import { TestCommand } from '../test/test-command'
import { Mock, Times, It } from 'typemoq'
import { sleep } from '../util'
import { MessageLogger, TestCommand2, testEventHandler } from '../test'
import * as faker from 'faker'
import { Logger } from '@node-ts/logger-core'
import { Handler, HandlerContext } from './handler'
import { TestCommand3 } from '../test/test-command-3'

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
  const messageLogger = Mock.ofType<MessageLogger>()

  // Sticky attributes should propagate during Bus.send
  const command2Handler: Handler<TestCommand2> = async () => { Bus.send(new TestCommand3()); await sleep(100) }
  const command3Handler = (logger: MessageLogger) => async ({ attributes: { stickyAttributes } }: HandlerContext<TestCommand3>) => logger.log(stickyAttributes.value)

  beforeAll(async () => {

    await Bus.configure()
      .withLogger(Mock.ofType<Logger>().object)
      .withConcurrency(2)
      .withHandler(TestEvent, testEventHandler(messageLogger.object))
      .withHandler(TestCommand2, command2Handler)
      .withHandler(TestCommand3, command3Handler(messageLogger.object))
      .initialize()

    await Bus.start()
    await Bus.publish(event)
    await Bus.publish(event, attributes)
    await Bus.send(command)

    await sleep(1)
  })

  afterAll(async () => Bus.stop())

  describe('when a handled message is received', () => {
    it('should dispatch to the registered handler', () => {
      messageLogger.verify(
        m => m.log(event),
        Times.exactly(2)
      )
    })
  })

  describe('when a handled message is received with attributes', () => {
    it('should receive the attributes', () => {
      messageLogger.verify(
        m => m.log(It.isObjectWith(attributes)),
        Times.once()
      )
    })
  })

  describe('when a handled message is received with sticky attributes', () => {
    beforeAll(async () => {
      const command2 = new TestCommand2()
      const attributes1: Partial<MessageAttributes> = {
        stickyAttributes: {
          value: 1
        }
      }
      const attributes2: Partial<MessageAttributes> = {
        stickyAttributes: {
          value: 2
        }
      }
      await Bus.send(command2, attributes1)
      await Bus.send(command2, attributes2)
      await sleep(1000)
    })

    it('should propagate sticky attributes', () => {
      messageLogger.verify(
        logger => logger.log(1),
        Times.once()
      )

      messageLogger.verify(
        logger => logger.log(2),
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

})
