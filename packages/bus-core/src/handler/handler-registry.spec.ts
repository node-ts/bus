import { HandlerRegistry } from './handler-registry'
import { Mock, IMock, Times, It } from 'typemoq'
import { Logger } from '@node-ts/logger-core'
import { TestEvent, TestEventHandler, TestCommandHandler } from '../test'
import { Container, interfaces } from 'inversify'

describe('HandlerRegistry', () => {
  let sut: HandlerRegistry

  let logger: IMock<Logger>

  const messageName = TestEvent.name
  const symbol = Symbol()
  const handler = TestEventHandler
  const messageType = TestEvent

  beforeEach(() => {
    logger = Mock.ofType<Logger>()
    sut = new HandlerRegistry(
      logger.object
    )
  })

  describe('when registring a handler', () => {
    beforeEach(() => {
      sut.register(messageName, symbol, handler, messageType)
    })

    it('should register the handler', () => {
      const handlers = sut.get(messageName)
      expect(handlers).toHaveLength(1)
    })

    describe('when binding handlers to the container', () => {
      let container: IMock<Container>
      let bindingTo: IMock<interfaces.BindingToSyntax<{}>>
      let bindingWhenOn: IMock<interfaces.BindingInWhenOnSyntax<{}>>

      beforeEach(() => {
        container = Mock.ofType<Container>()
        bindingTo = Mock.ofType<interfaces.BindingToSyntax<{}>>()
        bindingWhenOn = Mock.ofType<interfaces.BindingInWhenOnSyntax<{}>>()

        container
          .setup(c => c.bind(It.isAny()))
          .returns(() => bindingTo.object)
          .verifiable(Times.once())

        bindingTo
          .setup(b => b.to(handler))
          .returns(() => bindingWhenOn.object)
          .verifiable(Times.once())

        bindingWhenOn
          .setup(b => b.inTransientScope())
          .verifiable(Times.once())

        sut.bindHandlersToContainer(container.object)
      })

      it('should bind each handler', () => {
        container.verifyAll()
        bindingTo.verifyAll()
        bindingWhenOn.verifyAll()
      })
    })
  })

  describe('when registrying a handler twice', () => {
    beforeEach(() => {
      sut.register(messageName, symbol, handler, messageType)
      sut.register(messageName, symbol, handler, messageType)
    })

    it('should warn that the handler is already registered', () => {
      logger.verify(
        l => l.warn('Attempted to re-register a handler that\'s already registered', It.isAny()),
        Times.once()
      )
    })

    it('should register a single instance of the handler', () => {
      const handlers = sut.get(messageName)
      expect(handlers).toHaveLength(1)
    })
  })

  describe('when adding two handlers of the same name', () => {
    it('should throw an error', () => {
      sut.register(messageName, symbol, handler, messageType)
      expect(() => sut.register('random', symbol, handler, messageType)).toThrowError()
    })
  })

  describe('when getting a handler', () => {
    it('should return an empty array for an unregisterd handler', () => {
      expect(sut.get('')).toHaveLength(0)
    })

    it('should return a single handler for a single registration', () => {
      sut.register(messageName, symbol, handler, messageType)
      expect(sut.get(messageName)).toHaveLength(1)
    })

    it('should return a multiple handlers for multiple registrations', () => {
      sut.register(messageName, symbol, handler, messageType)
      sut.register(messageName, Symbol(), TestCommandHandler, messageType)
      expect(sut.get(messageName)).toHaveLength(2)
    })
  })

})
