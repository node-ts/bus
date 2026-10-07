import 'reflect-metadata'

import { Injectable, Scope } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import {
  BusInstance,
  BusMiddleware,
  BusState,
  ClassHandlerNotResolved,
  Handler,
  HandlerDispatchRejected,
  InMemoryQueue,
  deadLetter,
  handlerFor
} from '@node-ts/bus-core'
import { EventEmitter } from 'node:events'
import { BusModule } from './bus-module'
import {
  BusAlreadyRegistered,
  BusFeatureNotStatic,
  BusNotBuilt,
  BusNotRegistered,
  HandlerNotProvided
} from './error'
import { getBusToken } from './get-bus-token'
import { InjectBus } from './inject-bus'
import {
  BillingHandler,
  ChargeCreditCard,
  ChargeCreditCardHandler,
  FirstScopedHandler,
  FulfilmentWorkflow,
  MessageScope,
  OrderPlaced,
  OrderPlacedHandler,
  ProvisionedQueue,
  Recorder,
  SecondScopedHandler,
  messageTypes,
  orderPlacedAuditHandler,
  recorderModule,
  shippingWorkflow,
  testLogger
} from './test'

/**
 * A class handler that no module provides
 */
class UnprovidedHandler implements Handler<ChargeCreditCard> {
  get messageType() {
    return ChargeCreditCard
  }

  async handle(): Promise<void> {
    // Never reached, the bus can't resolve it
  }
}

/**
 * Compiles a testing module with the tests' logger and runs its bootstrap hooks
 */
const startApp = async (
  metadata: Parameters<typeof Test.createTestingModule>[0]
): Promise<TestingModule> => {
  const app = await Test.createTestingModule(metadata)
    .setLogger(testLogger() || console)
    .compile()
  await app.init()
  return app
}

/**
 * Captures the errors that fail the handling of a message
 */
const captureErrors = (errors: EventEmitter): BusMiddleware => ({
  incoming: async (_, next) => {
    try {
      await next()
    } catch (error) {
      errors.emit('error-captured', error)
      throw error
    }
  }
})

describe('BusModule', () => {
  describe('when handlers and workflows are registered in every way', () => {
    const queue = new ProvisionedQueue()
    let app: TestingModule
    let bus: BusInstance
    let recorder: Recorder
    let signalListenersBefore: number
    let signalListenersWhileRunning: number

    beforeAll(async () => {
      signalListenersBefore = process.listenerCount('SIGTERM')
      app = await startApp({
        imports: [
          recorderModule(),
          BusModule.forRoot({
            configure: configuration =>
              configuration.withTransport(queue).withMessageTypes(messageTypes)
          }),
          BusModule.forFeature({ handlers: [OrderPlacedHandler] }),
          BusModule.forFeatureAsync({
            inject: [Recorder],
            useFactory: (injected: Recorder) => ({
              handlers: [orderPlacedAuditHandler(injected)],
              workflows: [shippingWorkflow(injected)]
            })
          })
        ],
        providers: [
          ChargeCreditCardHandler,
          FulfilmentWorkflow,
          MessageScope,
          FirstScopedHandler,
          SecondScopedHandler
        ]
      })
      signalListenersWhileRunning = process.listenerCount('SIGTERM')
      bus = app.get(BusInstance)
      recorder = app.get(Recorder)

      await bus.send(new ChargeCreditCard('order-1', 10))
      await bus.publish(new OrderPlaced('order-1'))
      await bus.publish(new OrderPlaced('order-2'))
      await queue.idle()
    })

    afterAll(async () => app.close())

    it('should start the bus when the application bootstraps', () => {
      expect(bus.state).toEqual(BusState.Started)
      expect(queue.calls).toEqual(['start'])
    })

    it('should provide the bus as a BusInstance', () => {
      expect(bus).toBeInstanceOf(BusInstance)
    })

    it('should not listen for interrupt signals, leaving them to Nest', () => {
      expect(signalListenersWhileRunning).toEqual(signalListenersBefore)
    })

    it('should resolve a class handler decorated with @BusHandler() with its dependencies', () => {
      expect(recorder.by(ChargeCreditCardHandler.name)).toHaveLength(1)
    })

    it('should resolve a class handler registered with forFeature()', () => {
      expect(recorder.by(OrderPlacedHandler.name)).toHaveLength(2)
    })

    it('should dispatch to a function handler registered with forFeatureAsync()', () => {
      expect(recorder.by('orderPlacedAuditHandler')).toHaveLength(2)
    })

    it('should start a class workflow decorated with @BusWorkflow()', () => {
      expect(recorder.by(FulfilmentWorkflow.name)).toHaveLength(2)
    })

    it('should start a function workflow registered with forFeatureAsync()', () => {
      expect(recorder.by('shippingWorkflow')).toHaveLength(2)
    })

    it('should give the handlers of one message the same request-scoped provider, with the message as the request', () => {
      for (const orderId of ['order-1', 'order-2']) {
        const [first] = recorder
          .by(FirstScopedHandler.name)
          .filter(({ message }) => (message as OrderPlaced).orderId === orderId)
        const [second] = recorder
          .by(SecondScopedHandler.name)
          .filter(({ message }) => (message as OrderPlaced).orderId === orderId)
        const scope = first.detail as MessageScope
        expect(scope).toBeInstanceOf(MessageScope)
        expect(second.detail).toBe(scope)
        expect(scope.request.message).toMatchObject({ orderId })
        expect(scope.request.attributes?.messageId).toEqual(expect.any(String))
      }
    })

    it('should give each message a request scope of its own', () => {
      const [first, second] = recorder.by(FirstScopedHandler.name)
      expect(first.detail).not.toBe(second.detail)
    })
  })

  describe('when the application shuts down', () => {
    const queue = new ProvisionedQueue()
    let bus: BusInstance

    beforeAll(async () => {
      const app = await startApp({
        imports: [
          recorderModule(),
          BusModule.forRoot({
            configure: configuration =>
              configuration.withTransport(queue).withMessageTypes(messageTypes)
          })
        ],
        providers: [ChargeCreditCardHandler]
      })
      bus = app.get(BusInstance)
      await app.close()
    })

    it('should stop the bus, then dispose it', () => {
      expect(bus.state).toEqual(BusState.Stopped)
      expect(queue.calls).toEqual(['start', 'stop', 'dispose'])
    })
  })

  describe('when the bus is configured by forRootAsync() with injected providers', () => {
    const QUEUE = 'QUEUE'
    const queue = new InMemoryQueue()
    let app: TestingModule
    let recorder: Recorder

    beforeAll(async () => {
      class QueueModule {}
      app = await startApp({
        imports: [
          recorderModule(),
          BusModule.forRootAsync({
            imports: [
              {
                module: QueueModule,
                providers: [{ provide: QUEUE, useValue: queue }],
                exports: [QUEUE]
              }
            ],
            inject: [QUEUE],
            useFactory: (configuration, injectedQueue: InMemoryQueue) =>
              configuration
                .withTransport(injectedQueue)
                .withMessageTypes(messageTypes)
          })
        ],
        providers: [ChargeCreditCardHandler]
      })
      recorder = app.get(Recorder)
      await app.get(BusInstance).send(new ChargeCreditCard('order-1', 10))
      await queue.idle()
    })

    afterAll(async () => app.close())

    it('should run the bus on what the factory was given', () => {
      expect(recorder.by(ChargeCreditCardHandler.name)).toHaveLength(1)
    })
  })

  describe('when the lifecycle is manual', () => {
    const queue = new ProvisionedQueue()
    let app: TestingModule
    let bus: BusInstance
    let stateAfterBootstrap: BusState

    beforeAll(async () => {
      app = await startApp({
        imports: [
          recorderModule(),
          BusModule.forRoot({
            lifecycle: 'manual',
            configure: configuration =>
              configuration.withTransport(queue).withMessageTypes(messageTypes)
          })
        ],
        providers: [ChargeCreditCardHandler]
      })
      bus = app.get(BusInstance)
      stateAfterBootstrap = bus.state
      await bus.initialize()
      await bus.start()
      await app.close()
    })

    it('should leave initializing and starting the bus to the application', () => {
      expect(stateAfterBootstrap).toEqual(BusState.Stopped)
    })

    it('should still stop and dispose it when the application shuts down', () => {
      expect(queue.calls).toEqual(['start', 'stop', 'dispose'])
    })
  })

  describe('when the bus is send-only', () => {
    const queue = new ProvisionedQueue()
    let app: TestingModule
    let bus: BusInstance
    let sent: Promise<void>

    beforeAll(async () => {
      app = await startApp({
        imports: [
          BusModule.forRoot({
            configure: configuration =>
              configuration.withTransport(queue).asSendOnly()
          })
        ]
      })
      bus = app.get(BusInstance)
      sent = bus.send(new ChargeCreditCard('order-1', 10))
      await sent
    })

    afterAll(async () => app.close())

    it('should initialize it without starting it', async () => {
      expect(queue.calls).toEqual([])
      expect(bus.state).toEqual(BusState.Stopped)
    })

    it('should send', async () => {
      await expect(sent).resolves.toBeUndefined()
    })
  })

  describe('when a testing module overrides a dependency of a handler', () => {
    const queue = new InMemoryQueue()
    const fake = new Recorder()
    let app: TestingModule

    beforeAll(async () => {
      app = await Test.createTestingModule({
        imports: [
          recorderModule(),
          BusModule.forRoot({
            configure: configuration =>
              configuration.withTransport(queue).withMessageTypes(messageTypes)
          })
        ],
        providers: [ChargeCreditCardHandler]
      })
        .overrideProvider(Recorder)
        .useValue(fake)
        .setLogger(testLogger() || console)
        .compile()
      await app.init()
      await app.get(BusInstance).send(new ChargeCreditCard('order-1', 10))
      await queue.idle()
    })

    afterAll(async () => app.close())

    it('should give the handler the override', () => {
      expect(fake.by(ChargeCreditCardHandler.name)).toHaveLength(1)
    })
  })

  describe('when an application has several buses', () => {
    const defaultQueue = new InMemoryQueue()
    const billingQueue = new InMemoryQueue()
    let app: TestingModule
    let recorder: Recorder
    let billingService: BillingService

    class BillingService {
      constructor(readonly bus: BusInstance) {}
    }
    Injectable()(BillingService)
    InjectBus('billing')(BillingService, undefined, 0)

    beforeAll(async () => {
      app = await startApp({
        imports: [
          recorderModule(),
          BusModule.forRoot({
            configure: configuration =>
              configuration
                .withTransport(defaultQueue)
                .withMessageTypes(messageTypes)
          }),
          BusModule.forRoot({
            name: 'billing',
            configure: configuration =>
              configuration
                .withTransport(billingQueue)
                .withMessageTypes(messageTypes)
          })
        ],
        providers: [ChargeCreditCardHandler, BillingHandler, BillingService]
      })
      recorder = app.get(Recorder)
      billingService = app.get(BillingService)

      await app.get(BusInstance).send(new ChargeCreditCard('order-1', 10))
      await billingService.bus.send(new ChargeCreditCard('order-2', 20))
      await Promise.all([defaultQueue.idle(), billingQueue.idle()])
    })

    afterAll(async () => app.close())

    it('should inject a named bus with @InjectBus()', () => {
      expect(billingService.bus).toBe(app.get(getBusToken('billing')))
      expect(billingService.bus).not.toBe(app.get(BusInstance))
    })

    it('should register each handler with its own bus', () => {
      expect(
        recorder.by(ChargeCreditCardHandler.name).map(({ message }) => message)
      ).toEqual([expect.objectContaining({ orderId: 'order-1' })])
      expect(
        recorder.by(BillingHandler.name).map(({ message }) => message)
      ).toEqual([expect.objectContaining({ orderId: 'order-2' })])
    })
  })

  describe('when a class handler added in configure() is not a provider', () => {
    const queue = new InMemoryQueue()
    const errors = new EventEmitter()
    let app: TestingModule
    let error: Error

    beforeAll(async () => {
      app = await startApp({
        imports: [
          BusModule.forRoot({
            configure: configuration =>
              configuration
                .withTransport(queue)
                .withMessageTypes(messageTypes)
                .withMiddleware(captureErrors(errors))
                .withRecoverability(() => deadLetter())
                .withHandler(UnprovidedHandler)
          })
        ]
      })
      const captured = new Promise<Error>(resolve =>
        errors.once('error-captured', resolve)
      )
      await app.get(BusInstance).send(new ChargeCreditCard('order-1', 10))
      error = await captured
    })

    afterAll(async () => app.close())

    it('should fail the message, saying to make it a provider', () => {
      const [rejection] = (error as HandlerDispatchRejected).rejections
      expect(rejection).toBeInstanceOf(ClassHandlerNotResolved)
      const cause = (rejection as ClassHandlerNotResolved).cause
      expect(cause).toBeInstanceOf(HandlerNotProvided)
      expect((cause as HandlerNotProvided).help).toContain('providers')
    })
  })

  describe('when the application fails to start', () => {
    const startFails = async (
      metadata: Parameters<typeof Test.createTestingModule>[0]
    ): Promise<unknown> => {
      const app = await Test.createTestingModule(metadata)
        .setLogger(testLogger() || console)
        .compile()
      try {
        await app.init()
      } catch (error) {
        // Closing an application that failed to initialize rethrows the error, and nothing was built to dispose
        return error
      }
      await app.close()
      throw new Error('Expected the application to fail to start')
    }

    const forRoot = (name?: string) =>
      BusModule.forRoot({
        name,
        configure: configuration =>
          configuration
            .withTransport(new InMemoryQueue())
            .withMessageTypes(messageTypes)
      })

    describe('and handlers are registered with a bus that is not registered', () => {
      let error: unknown

      beforeAll(async () => {
        error = await startFails({
          imports: [
            recorderModule(),
            forRoot(),
            BusModule.forFeature({
              bus: 'reporting',
              handlers: [OrderPlacedHandler]
            })
          ],
          providers: [BillingHandler]
        })
      })

      it('should throw BusNotRegistered, naming the bus and what registered with it', () => {
        expect(error).toBeInstanceOf(BusNotRegistered)
        const busNotRegistered = error as BusNotRegistered
        expect(['reporting', 'billing']).toContain(busNotRegistered.busName)
        expect(busNotRegistered.help).toContain('BusModule.forRoot')
      })
    })

    describe('and two buses have the same name', () => {
      let error: unknown

      beforeAll(async () => {
        error = await startFails({ imports: [forRoot(), forRoot()] })
      })

      it('should throw BusAlreadyRegistered', () => {
        expect(error).toBeInstanceOf(BusAlreadyRegistered)
        expect((error as BusAlreadyRegistered).busName).toEqual('default')
      })
    })

    describe('and forFeatureAsync() injects a request-scoped provider', () => {
      let error: unknown

      beforeAll(async () => {
        class ScopeModule {}
        error = await startFails({
          imports: [
            forRoot(),
            BusModule.forFeatureAsync({
              imports: [
                {
                  module: ScopeModule,
                  providers: [
                    {
                      provide: 'SCOPED',
                      scope: Scope.REQUEST,
                      useFactory: () => 'scoped'
                    }
                  ],
                  exports: ['SCOPED']
                }
              ],
              inject: ['SCOPED'],
              useFactory: () => ({ handlers: [] })
            })
          ]
        })
      })

      it('should throw BusFeatureNotStatic', () => {
        expect(error).toBeInstanceOf(BusFeatureNotStatic)
      })
    })

    describe('and a class handler declared with handlerFor() is not a provider', () => {
      let error: unknown

      beforeAll(async () => {
        error = await startFails({
          imports: [
            forRoot(),
            BusModule.forFeatureAsync({
              useFactory: () => ({
                handlers: [handlerFor(ChargeCreditCard, UnprovidedHandler)]
              })
            })
          ]
        })
      })

      it('should throw HandlerNotProvided, naming the class', () => {
        expect(error).toBeInstanceOf(HandlerNotProvided)
        expect((error as HandlerNotProvided).className).toEqual(
          UnprovidedHandler.name
        )
      })
    })
  })

  describe('when a provider uses the bus before it is built', () => {
    let error: unknown

    beforeAll(async () => {
      try {
        await Test.createTestingModule({
          imports: [
            BusModule.forRoot({ configure: configuration => configuration })
          ],
          providers: [
            {
              provide: 'EAGER',
              inject: [BusInstance],
              useFactory: (bus: BusInstance) => bus.state
            }
          ]
        })
          .setLogger(testLogger() || console)
          .compile()
      } catch (e) {
        error = e
      }
    })

    it('should throw BusNotBuilt, naming what was used', () => {
      expect(error).toBeInstanceOf(BusNotBuilt)
      expect((error as BusNotBuilt).member).toEqual('state')
    })
  })
})
