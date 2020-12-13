import { TestEvent } from '../test/test-event'
import { Bus } from '../service-bus'
import { MessageAttributes } from '@node-ts/bus-messages'
import { TestCommand } from '../test/test-command'
import { IMock, Mock, Times, It } from 'typemoq'
import { sleep } from '../util'
import { MessageLogger, testEventHandler } from '../test'
import * as faker from 'faker'
import { Logger } from '@node-ts/logger-core'

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
  let messageLogger: IMock<MessageLogger>

  beforeAll(async () => {
    messageLogger = Mock.ofType<MessageLogger>()

    await Bus.configure()
      .withLogger(Mock.ofType<Logger>().object)
      .withHandler(TestEvent, testEventHandler(messageLogger.object))
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

  describe('when an unhandled message is received', () => {
    it('should not handle the message', () => {
      messageLogger.verify(
        m => m.log(command),
        Times.never()
      )
    })
  })

})
