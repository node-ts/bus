import { ApplicationBootstrap } from './application-bootstrap'
import { Mock, IMock, Times, It } from 'typemoq'
import { Bus } from '../service-bus'
import { HandlerRegistry, HandlerResolver } from '../handler'
import { Logger } from '@node-ts/logger-core'
import { Container } from 'inversify'
import { TestCommandHandler, TestCommand } from '../test'
import { Transport } from '../transport'

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

  describe('when initializing send only', () => {
    let container: IMock<Container>
    describe('that starts successfully', () => {
      beforeEach(async () => {
        container = Mock.ofType<Container>()
        await sut.initializeSendOnly()
      })
      it('should bind no handlers to the IoC container', () => {
        handlerRegistry.verify(
          h => h.bindHandlersToContainer(container.object),
          Times.never()
        )
      })
      it('should not start the bus', () => {
        bus.verify(
          async b => b.start(),
          Times.never()
        )
      })
      it('should throw an exception when initializing twice', async () => {
        await expect(sut.initializeSendOnly()).rejects.toThrowError()
      })
    })
    describe('when handlers have been registered', () => {
      it('should throw an error', async () => {
        handlerRegistry
          .setup(h => h.messageSubscriptions)
          .returns(() => [{} as HandlerResolver])
        await expect(sut.initializeSendOnly()).rejects.toThrowError()
      })
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
          TestCommand,
          undefined
        ),
        Times.once()
      )
    })
  })
})
