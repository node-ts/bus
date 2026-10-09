import 'reflect-metadata'

import {
  BeforeApplicationShutdown,
  Injectable,
  OnApplicationShutdown,
  OnModuleDestroy,
  Scope
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import {
  Bus,
  BusInstance,
  BusMiddleware,
  BusState,
  ClassHandlerNotResolved,
  Handler,
  HandlerDispatchRejected,
  InMemoryQueue,
  Logger,
  deadLetter,
  handlerFor,
  retry
} from '@node-ts/bus-core'
import { EventEmitter } from 'node:events'
import { Mock } from 'typemoq'
import { BusModule } from './bus-module'
import {
  BusAlreadyRegistered,
  BusClassNotProvided,
  BusFeatureNotStatic,
  BusNotBuilt,
  BusNotRegistered,
  WorkflowResolvedWithoutMessage
} from './error'
import { getBusToken } from './get-bus-token'
import { InjectBus } from './inject-bus'
import {
  BillingHandler,
  ChargeAttempt,
  ChargeAttemptHandler,
  ChargeAttemptWorkflow,
  ChargeCreditCard,
  ChargeCreditCardHandler,
  DECLINED_ONCE,
  FirstScopedHandler,
  FulfilmentWorkflow,
  MessageScope,
  OrderPlaced,
  OrderPlacedHandler,
  ProvisionedQueue,
  Recorder,
  RecordingLogger,
  RequestScopedWorkflow,
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
          OrderPlacedHandler,
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

  describe('when request-scoped providers handle a message that is retried and sent again', () => {
    const queue = new ProvisionedQueue()
    const declinedOnce = new ChargeCreditCard(DECLINED_ONCE, 10)
    const sentTwice = new ChargeCreditCard('sent-twice', 10)
    let app: TestingModule
    let recorder: Recorder

    /**
     * What the handler and workflow recorded for one order, in the order they handled its deliveries
     */
    const attemptsFor = (command: ChargeCreditCard) => {
      const of = (name: string) =>
        recorder
          .by(name)
          .filter(({ message }) => message === command)
          .map(({ detail }) => detail as ChargeAttempt)
      return {
        handler: of(ChargeAttemptHandler.name),
        workflow: of(ChargeAttemptWorkflow.name)
      }
    }

    beforeAll(async () => {
      app = await startApp({
        imports: [
          recorderModule(),
          BusModule.forRoot({
            configure: configuration =>
              configuration
                .withTransport(queue)
                .withMessageTypes(messageTypes)
                .withLogger(() => Mock.ofType<Logger>().object)
                .withRecoverability(() => retry(0))
          }),
          BusModule.forFeature({
            handlers: [ChargeAttemptHandler],
            workflows: [ChargeAttemptWorkflow]
          })
        ],
        providers: [ChargeAttempt, ChargeAttemptHandler, ChargeAttemptWorkflow]
      })
      recorder = app.get(Recorder)
      const bus = app.get(BusInstance)

      await bus.send(declinedOnce)
      await queue.idle()
      await bus.send(sentTwice)
      await bus.send(sentTwice)
      await queue.idle()
    })

    afterAll(async () => app.close())

    it('should give the retry a request scope of its own, without the state of the attempt that failed', () => {
      const { handler } = attemptsFor(declinedOnce)
      expect(handler).toHaveLength(2)
      const [failed, retried] = handler
      expect(retried).not.toBe(failed)
      expect(retried.charges).toEqual([DECLINED_ONCE])
    })

    it('should give each send of the same message a request scope of its own', () => {
      const { handler } = attemptsFor(sentTwice)
      expect(handler).toHaveLength(2)
      const [first, second] = handler
      expect(second).not.toBe(first)
      expect(second.charges).toEqual(['sent-twice'])
    })

    it('should give the handler and workflow of each delivery the same request scope, with the message as the request', () => {
      for (const command of [declinedOnce, sentTwice]) {
        const { handler, workflow } = attemptsFor(command)
        expect(workflow).toHaveLength(2)
        workflow.forEach((attempt, delivery) => {
          expect(attempt).toBe(handler[delivery])
          expect(attempt.request.message).toBe(command)
        })
      }
    })
  })

  describe('when the application shuts down while a message is being handled', () => {
    const events: string[] = []
    let bus: BusInstance

    /**
     * A queue that lets the handler finish once the bus stops it, so the message is in flight while Nest runs the
     * other modules' onModuleDestroy
     */
    class GatedQueue extends ProvisionedQueue {
      constructor(private readonly onStop: () => void) {
        super(events)
      }

      async stop(): Promise<void> {
        await super.stop()
        this.onStop()
      }
    }

    /**
     * A provider of a feature module, such as a database client, that records Nest's shutdown hooks
     */
    class Database
      implements
        OnModuleDestroy,
        BeforeApplicationShutdown,
        OnApplicationShutdown
    {
      onModuleDestroy(): void {
        events.push('database onModuleDestroy')
      }

      beforeApplicationShutdown(): void {
        events.push('database beforeApplicationShutdown')
      }

      onApplicationShutdown(): void {
        events.push('database onApplicationShutdown')
      }
    }
    class DatabaseModule {}

    beforeAll(async () => {
      let release: () => void = () => undefined
      const released = new Promise<void>(resolve => (release = resolve))
      let handling: () => void = () => undefined
      const handlerStarted = new Promise<void>(resolve => (handling = resolve))
      const queue = new GatedQueue(() => release())

      const app = await startApp({
        imports: [
          { module: DatabaseModule, providers: [Database] },
          BusModule.forRoot({
            configure: configuration =>
              configuration
                .withTransport(queue)
                .withMessageTypes(messageTypes)
                .withHandler(
                  handlerFor(ChargeCreditCard, async () => {
                    events.push('handler started')
                    handling()
                    await released
                    events.push('handler finished')
                  })
                )
          })
        ]
      })
      bus = app.get(BusInstance)
      await bus.send(new ChargeCreditCard('order-1', 10))
      await handlerStarted
      await app.close()
    })

    it('should stop the bus after the onModuleDestroy of other modules, finishing the message before their later shutdown hooks', () => {
      expect(events).toEqual([
        'start',
        'handler started',
        'database onModuleDestroy',
        'stop',
        'handler finished',
        'database beforeApplicationShutdown',
        'database onApplicationShutdown',
        'dispose'
      ])
    })

    it('should leave the bus stopped', () => {
      expect(bus.state).toEqual(BusState.Stopped)
    })
  })

  describe('when configure() returns a configuration it was not given', () => {
    const logger = new RecordingLogger()
    let app: TestingModule

    beforeAll(async () => {
      app = await Test.createTestingModule({
        imports: [
          BusModule.forRoot({
            configure: () =>
              Bus.configure()
                .withLogger(() => Mock.ofType<Logger>().object)
                .withInterruptSignals([])
          })
        ]
      })
        .setLogger(logger)
        .compile()
      await app.init()
    })

    afterAll(async () => app.close())

    it('should warn that the logger and shutdown handling of Nest are lost', () => {
      expect(logger.calls).toContainEqual([
        'warn',
        expect.stringContaining("isn't the one BusModule gave its factory"),
        { bus: 'default' },
        '@node-ts/bus-nestjs:bus-module'
      ])
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
      expect(cause).toBeInstanceOf(BusClassNotProvided)
      expect((cause as BusClassNotProvided).help).toContain('providers')
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

    describe('and a class registered with forFeature() is not a provider', () => {
      let error: unknown

      beforeAll(async () => {
        error = await startFails({
          imports: [
            recorderModule(),
            forRoot(),
            BusModule.forFeature({ handlers: [OrderPlacedHandler] })
          ]
        })
      })

      it('should throw BusClassNotProvided, naming the class and saying to add it to providers', () => {
        expect(error).toBeInstanceOf(BusClassNotProvided)
        const notProvided = error as BusClassNotProvided
        expect(notProvided.className).toEqual(OrderPlacedHandler.name)
        expect(notProvided.help).toContain('providers')
      })
    })

    describe('and a request-scoped class workflow reads REQUEST in its constructor', () => {
      const queue = new ProvisionedQueue()
      let error: unknown

      beforeAll(async () => {
        error = await startFails({
          imports: [
            BusModule.forRoot({
              configure: configuration =>
                configuration
                  .withTransport(queue)
                  .withMessageTypes(messageTypes)
            }),
            BusModule.forFeature({ workflows: [RequestScopedWorkflow] })
          ],
          providers: [RequestScopedWorkflow]
        })
      })

      it('should throw WorkflowResolvedWithoutMessage, naming the workflow', () => {
        expect(error).toBeInstanceOf(WorkflowResolvedWithoutMessage)
        const resolvedWithoutMessage = error as WorkflowResolvedWithoutMessage
        expect(resolvedWithoutMessage.className).toEqual(
          RequestScopedWorkflow.name
        )
        expect(resolvedWithoutMessage.cause).toBeInstanceOf(TypeError)
        expect(resolvedWithoutMessage.help).toContain('REQUEST')
      })

      it('should dispose the bus', () => {
        expect(queue.calls).toEqual(['dispose'])
      })
    })

    describe('and the transport fails to initialize', () => {
      const transportError = new Error('Connection refused')
      const queue = new ProvisionedQueue([], transportError)
      let error: unknown

      beforeAll(async () => {
        error = await startFails({
          imports: [
            BusModule.forRoot({
              configure: configuration =>
                configuration
                  .withTransport(queue)
                  .withMessageTypes(messageTypes)
            })
          ]
        })
      })

      it('should rethrow the error', () => {
        expect(error).toBe(transportError)
      })

      it('should dispose the bus', () => {
        expect(queue.calls).toEqual(['dispose'])
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

      it('should throw BusClassNotProvided, naming the class', () => {
        expect(error).toBeInstanceOf(BusClassNotProvided)
        expect((error as BusClassNotProvided).className).toEqual(
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
