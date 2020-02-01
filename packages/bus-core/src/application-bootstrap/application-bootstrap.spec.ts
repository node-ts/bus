import { ApplicationBootstrap } from './application-bootstrap'
import { Mock, IMock, Times, It } from 'typemoq'
import { Bus } from '../service-bus'
import { HandlerRegistry } from '../handler'
import { Logger } from '@node-ts/logger-core'
import { Container } from 'inversify'
import { TestCommandHandler, TestCommand } from '../test'
import { Transport } from '../transport'
import { Message } from '@node-ts/bus-messages'

describe('ApplicationBootstrap', () => {
  let sut: ApplicationBootstrap
  let bus: IMock<Bus>
  let transport: IMock<Transport>
  let handlerRegistry: IMock<HandlerRegistry>

  beforeEach(() => {
    bus = Mock.ofType<Bus>()
    transport = Mock.ofType<Transport>()
    handlerRegistry = Mock.ofType<HandlerRegistry>()

    sut = new ApplicationBootstrap(
      bus.object,
      transport.object,
      handlerRegistry.object,
      Mock.ofType<Logger>().object
    )
  })

  describe('when initializing', () => {
    let container: IMock<Container>

    beforeEach(async () => {
      container = Mock.ofType<Container>()
      await sut.initialize(container.object)
    })

    it('should bind all handlers to the IoC container', () => {
      handlerRegistry.verify(
        h => h.bindHandlersToContainer(container.object),
        Times.once()
      )
    })

    it('should start the bus', () => {
      bus.verify(
        async b => b.start(),
        Times.once()
      )
    })
  })

  describe('when registering handlers', () => {
    beforeEach(() => {
      sut.registerHandler(TestCommandHandler)
    })

    it('should add the handler to the registry', () => {
      handlerRegistry.verify(
        h => h.register(
          It.isAny(),
          It.isAny(),
          TestCommandHandler,
          TestCommand
        ),
        Times.once()
      )
    })
  })
})
