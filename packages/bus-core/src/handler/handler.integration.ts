import { TestEvent } from '../test/test-event'
import { Bus, MessageAttributes } from '../service-bus'
import { TestCommand } from '../test/test-command'
import { Container } from 'inversify'
import { BUS_SYMBOLS } from '../bus-symbols'
import { ApplicationBootstrap } from '../application-bootstrap'
import { IMock, Mock, Times, It } from 'typemoq'
import { sleep } from '../util'
import { TestContainer } from '../test/test-container'
import { MessageLogger, MESSAGE_LOGGER, TestEventHandler } from '../test'
import * as faker from 'faker'

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
  let serviceBus: Bus
  let container: Container
  let bootstrapper: ApplicationBootstrap
  let messageLogger: IMock<MessageLogger>

  beforeAll(async () => {
    container = new TestContainer().silenceLogs()

    messageLogger = Mock.ofType<MessageLogger>()
    container.bind(MESSAGE_LOGGER).toConstantValue(messageLogger.object)

    serviceBus = container.get(BUS_SYMBOLS.Bus)
    bootstrapper = container.get(BUS_SYMBOLS.ApplicationBootstrap)

    bootstrapper.registerHandler(TestEventHandler)
    await bootstrapper.initialize(container)

    await serviceBus.publish(event)
    await serviceBus.publish(event, attributes)
    await serviceBus.send(command)
    await sleep(1)
  })

  afterAll(async () => {
    await serviceBus.stop()
  })

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
