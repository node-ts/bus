import { TestEvent } from '../test/test-event'
import { Bus } from '../service-bus'
import { TestCommand } from '../test/test-command'
import { Container } from 'inversify'
import { BUS_SYMBOLS } from '../bus-symbols'
import { ApplicationBootstrap } from '../application-bootstrap'
import { IMock, Mock, Times } from 'typemoq'
import { sleep } from '../util'
import { TestContainer } from '../test/test-container'
import { MessageLogger, MESSAGE_LOGGER, TestEventHandler } from '../test'


const event = new TestEvent()
const command = new TestCommand()

describe('Handler', () => {
  let serviceBus: Bus
  let container: Container
  let bootstrapper: ApplicationBootstrap
  let messageLogger: IMock<MessageLogger>

  beforeAll(async () => {
    container = new TestContainer()

    messageLogger = Mock.ofType<MessageLogger>()
    container.bind(MESSAGE_LOGGER).toConstantValue(messageLogger.object)

    serviceBus = container.get(BUS_SYMBOLS.Bus)
    bootstrapper = container.get(BUS_SYMBOLS.ApplicationBootstrap)

    bootstrapper.registerHandler(TestEventHandler)
    await bootstrapper.initialize(container)
  })

  afterAll(async () => {
    await serviceBus.stop()
  })

  describe('when a handled message is received', () => {
    beforeAll(async () => {
      await serviceBus.publish(event)
      await sleep(1)
    })

    it('should dispatch to the registered handler', () => {
      messageLogger.verify(
        m => m.log(event),
        Times.once()
      )
    })
  })

  describe('when an unhandled message is received', () => {
    beforeAll(async () => {
      await serviceBus.send(command)
    })

    it('should not handle the message', () => {
      messageLogger.verify(
        m => m.log(command),
        Times.never()
      )
    })
  })

})
