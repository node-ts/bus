import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import { HandlerContext, handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  DelayedDeliveryNotSupported,
  DelayedDeliveryUnsupportedReason,
  InvalidDeliveryOptions,
  OutgoingMessage,
  SendOptions
} from '../outgoing-message'
import { Receiver } from '../receiver'
import { deadLetter } from '../recoverability'
import { RecordingInMemoryQueue, testMessageTypes } from '../test'
import { TestCommand } from '../test/test-command'
import { TestEvent } from '../test/test-event'
import {
  InMemoryMessage,
  InMemoryQueue,
  TransportInitializationOptions,
  TransportMessage
} from '../transport'
import { sleep } from '../util'
import { InMemoryPersistence, Persistence } from '../workflow'
import { Bus } from './bus'
import { BusConfiguration } from './bus-configuration'
import { BusInstance } from './bus-instance'
import { InvalidOperation } from './error'

jest.setTimeout(20_000)

/**
 * A persistence that stores workflow state but not messages to send later
 */
class WorkflowOnlyPersistence implements Persistence {
  prepare(): void {}
  async getWorkflowState(): Promise<never[]> {
    return []
  }
  async saveWorkflowState(): Promise<void> {}
}

/**
 * An in-memory persistence that counts how often it's disposed
 */
class CountingPersistence extends InMemoryPersistence {
  disposeCount = 0

  async dispose(): Promise<void> {
    this.disposeCount++
  }
}

/**
 * An in-memory persistence that counts its claims
 */
class ClaimCountingPersistence extends InMemoryPersistence {
  claims = 0

  async claimDueOutgoingMessages(
    limit: number,
    leaseMs: number,
    maxLeaseMs: number,
    now?: Date
  ): Promise<OutgoingMessage[]> {
    if (!now) {
      this.claims++
    }
    return super.claimDueOutgoingMessages(limit, leaseMs, maxLeaseMs, now)
  }
}

/**
 * A recording queue that counts its reads and remembers how it was initialized
 */
class ReadCountingQueue extends RecordingInMemoryQueue {
  reads = 0
  initializedSendOnly: boolean | undefined

  async initialize(options?: TransportInitializationOptions): Promise<void> {
    this.initializedSendOnly = options?.sendOnly
    await super.initialize(options)
  }

  async readNextMessage(): Promise<
    TransportMessage<InMemoryMessage> | undefined
  > {
    this.reads++
    return super.readNextMessage()
  }
}

/**
 * Long after any message a test schedules is due
 */
const END_OF_TIME = new Date(8_640_000_000_000_000)

const silentLogger = () => Mock.ofType<Logger>().object

const fastQueue = () => new InMemoryQueue({ receiveTimeoutMs: 100 })

interface Received {
  message: Message
  attributes: MessageAttributes
  transportMessage: TransportMessage<InMemoryMessage>
  receivedAt: number
}

describe('BusInstance delayed delivery', () => {
  describe('when a command is sent with deliverAfter', () => {
    const deliverAfter = 1_000
    const events = new EventEmitter()
    let bus: BusInstance
    let sentAt: number
    let outgoingMiddlewareCalls = 0
    let middlewareMessageId: string | undefined
    let received: Received

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(fastQueue())
        .withMiddleware({
          outgoing: async (context, next) => {
            outgoingMiddlewareCalls++
            middlewareMessageId = context.attributes.messageId
            context.headers['x-tenant'] = 'tenant-a'
            await next()
          }
        })
        .withHandler(
          handlerFor(TestCommand, async (message, attributes) => {
            events.emit('received', {
              message,
              attributes,
              transportMessage: bus.getHandlingContext(),
              receivedAt: Date.now()
            })
          })
        )
        .build()
      await bus.initialize()
      await bus.start()

      const receivedEvent = once(events, 'received')
      sentAt = Date.now()
      await bus.send(new TestCommand(), {
        deliverAfter,
        correlationId: 'delayed-correlation',
        attributes: { tenant: 'a' },
        stickyAttributes: { journey: 'b' }
      })
      ;[received] = (await receivedEvent) as [Received]
    })

    afterAll(async () => bus.dispose())

    it('should not deliver it before it is due', () => {
      expect(received.receivedAt).toBeGreaterThanOrEqual(sentAt + deliverAfter)
    })

    it('should deliver it soon after it is due', () => {
      expect(received.receivedAt).toBeLessThan(sentAt + deliverAfter + 1_000)
    })

    it('should restore the message class', () => {
      expect(received.message).toBeInstanceOf(TestCommand)
    })

    it('should keep its correlation id, attributes and sticky attributes', () => {
      expect(received.attributes).toMatchObject({
        correlationId: 'delayed-correlation',
        attributes: { tenant: 'a' },
        stickyAttributes: { journey: 'b' }
      })
    })

    it('should keep the message id the outgoing middleware saw', () => {
      expect(received.attributes.messageId).toEqual(middlewareMessageId)
    })

    it('should keep the headers set by outgoing middleware', () => {
      expect(received.transportMessage.raw.headers).toEqual({
        'x-tenant': 'tenant-a'
      })
    })

    it('should run the outgoing middleware once', () => {
      expect(outgoingMiddlewareCalls).toEqual(1)
    })
  })

  describe('when a handler publishes an event with deliverAt', () => {
    const events = new EventEmitter()
    let bus: BusInstance
    let commandAttributes: MessageAttributes
    let eventAttributes: MessageAttributes

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(fastQueue())
        .withHandler(
          handlerFor(TestCommand, async (_message, attributes, ctx) => {
            commandAttributes = attributes
            await ctx.publish(new TestEvent('delayed'), {
              deliverAt: new Date(Date.now() + 300)
            })
          })
        )
        .withHandler(
          handlerFor(TestEvent, async (_message, attributes) => {
            events.emit('received', attributes)
          })
        )
        .build()
      await bus.initialize()
      await bus.start()

      const receivedEvent = once(events, 'received')
      await bus.send(new TestCommand(), {
        stickyAttributes: { journey: 'from-command' }
      })
      ;[eventAttributes] = (await receivedEvent) as [MessageAttributes]
    })

    afterAll(async () => bus.dispose())

    it('should keep the correlation id of the message being handled', () => {
      expect(eventAttributes.correlationId).toEqual(
        commandAttributes.correlationId
      )
    })

    it('should keep the sticky attributes of the message being handled', () => {
      expect(eventAttributes.stickyAttributes).toEqual({
        journey: 'from-command'
      })
    })
  })

  describe.each<[string, (ctx: HandlerContext) => Promise<void>]>([
    [
      'throws',
      async () => {
        throw new Error('handler failed')
      }
    ],
    ['calls failMessage()', async ctx => ctx.failMessage()],
    ['calls returnMessage()', async ctx => ctx.returnMessage()]
  ])('when a handler that sent a delayed message %s', (_, endHandler) => {
    const persistence = new InMemoryPersistence()
    let bus: BusInstance
    let stored: unknown[]

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined, {
        receiveTimeoutMs: 100
      })
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withRecoverability(() => deadLetter())
        .withHandler(
          handlerFor(TestCommand, async (_message, _attributes, ctx) => {
            await ctx.publish(new TestEvent(), { deliverAfter: 60_000 })
            await endHandler(ctx)
          })
        )
        .build()
      await bus.initialize()
      await bus.start()

      const deadLettered = once(queue.settled, 'failed')
      await bus.send(new TestCommand())
      await deadLettered
      stored = await persistence.claimDueOutgoingMessages(10, 1, 1, END_OF_TIME)
    })

    afterAll(async () => bus.dispose())

    it('should not schedule it', () => {
      expect(stored).toEqual([])
    })
  })

  describe('when deliverAt has already passed', () => {
    const dispatched = Mock.ofType<(message: Message) => void>()
    let bus: BusInstance

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(
          new RecordingInMemoryQueue(message => dispatched.object(message))
        )
        .build()
      await bus.initialize()
      await bus.send(new TestCommand(), {
        deliverAt: new Date(Date.now() - 1_000)
      })
    })

    afterAll(async () => bus.dispose())

    it('should send it straight away', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestCommand.NAME })),
        Times.once()
      )
    })
  })

  describe('when a send-only bus schedules a message', () => {
    const persistence = new InMemoryPersistence()
    const events = new EventEmitter()
    let sendOnlyBus: BusInstance
    let receivingBus: BusInstance
    let receivedMessage: Message

    beforeAll(async () => {
      sendOnlyBus = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(persistence)
        .asSendOnly()
        .build()
      receivingBus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(fastQueue())
        .withPersistence(persistence)
        .withHandler(
          handlerFor(TestEvent, async message => {
            events.emit('received', message)
          })
        )
        .build()
      await sendOnlyBus.initialize()
      await receivingBus.initialize()
      await receivingBus.start()

      const receivedEvent = once(events, 'received')
      await sendOnlyBus.publish(new TestEvent('from-send-only'), {
        deliverAfter: 200
      })
      ;[receivedMessage] = (await receivedEvent) as [Message]
    })

    afterAll(async () => {
      await sendOnlyBus.dispose()
      await receivingBus.dispose()
    })

    it('should be sent by a started bus that uses the same persistence', () => {
      expect(receivedMessage).toMatchObject({ property1: 'from-send-only' })
    })
  })

  describe('when several buses share one store', () => {
    const messageCount = 30
    const persistence = new InMemoryPersistence()
    const events = new EventEmitter()
    const receivedIds: string[] = []
    let buses: BusInstance[]
    let sendOnlyBus: BusInstance

    beforeAll(async () => {
      buses = [1, 2, 3].map(() =>
        Bus.configure()
          .withMessageTypes(testMessageTypes)
          .withLogger(silentLogger)
          .withTransport(fastQueue())
          .withPersistence(persistence)
          .withHandler(
            handlerFor(TestCommand, async (_message, attributes) => {
              receivedIds.push(attributes.messageId!)
              if (receivedIds.length === messageCount) {
                events.emit('all-received')
              }
            })
          )
          .build()
      )
      sendOnlyBus = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(persistence)
        .asSendOnly()
        .build()
      await sendOnlyBus.initialize()
      for (const bus of buses) {
        await bus.initialize()
        await bus.start()
      }

      const allReceived = once(events, 'all-received')
      for (let i = 0; i < messageCount; i++) {
        await sendOnlyBus.send(new TestCommand(), { deliverAfter: 200 })
      }
      await allReceived
      // Give a duplicate time to arrive
      await new Promise(resolve => setTimeout(resolve, 1_500))
    })

    afterAll(async () => {
      await sendOnlyBus.dispose()
      for (const bus of buses) {
        await bus.dispose()
      }
    })

    it('should send each message once', () => {
      expect(receivedIds).toHaveLength(messageCount)
      expect(new Set(receivedIds).size).toEqual(messageCount)
    })
  })

  describe('with the default InMemoryPersistence', () => {
    const logger = Mock.ofType<Logger>()
    let bus: BusInstance

    beforeAll(async () => {
      // Not send-only, so a delayed send is allowed: it sends the message itself once it's started
      bus = Bus.configure()
        .withLogger(() => logger.object)
        .build()
      await bus.initialize()
      await bus.send(new TestCommand(), { deliverAfter: 60_000 })
      await bus.publish(new TestEvent(), { deliverAfter: 60_000 })
    })

    afterAll(async () => bus.dispose())

    it('should warn once that scheduled messages are lost on restart', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(
              message =>
                message.includes('InMemoryPersistence') &&
                message.includes("doesn't survive a restart") &&
                message.includes('withPersistence()')
            ),
            It.isAny()
          ),
        Times.once()
      )
    })
  })

  describe('with a persistence that does not store outgoing messages', () => {
    let bus: BusInstance
    let error: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(new WorkflowOnlyPersistence())
        .asSendOnly()
        .build()
      await bus.initialize()
      try {
        await bus.send(new TestCommand(), { deliverAfter: 1_000 })
      } catch (e) {
        error = e
      }
    })

    afterAll(async () => bus.dispose())

    it('should throw DelayedDeliveryNotSupported naming the persistence and the fix', () => {
      expect(error).toBeInstanceOf(DelayedDeliveryNotSupported)
      const notSupported = error as DelayedDeliveryNotSupported
      expect(notSupported.persistenceName).toEqual('WorkflowOnlyPersistence')
      expect(notSupported.message).toContain('WorkflowOnlyPersistence')
      expect(notSupported.help).toContain('withPersistence()')
    })
  })

  describe('with invalid delivery options', () => {
    let bus: BusInstance

    beforeAll(async () => {
      bus = Bus.configure().withLogger(silentLogger).build()
      await bus.initialize()
    })

    afterAll(async () => bus.dispose())

    it.each<[string, SendOptions]>([
      ['a negative deliverAfter', { deliverAfter: -1 }],
      ['a deliverAfter that is not finite', { deliverAfter: Infinity }],
      ['an invalid deliverAt', { deliverAt: new Date('not a date') }],
      [
        'both deliverAfter and deliverAt',
        { deliverAfter: 1, deliverAt: new Date() } as unknown as SendOptions
      ]
    ])('should reject %s with InvalidDeliveryOptions', async (_, options) => {
      await expect(bus.send(new TestCommand(), options)).rejects.toBeInstanceOf(
        InvalidDeliveryOptions
      )
    })
  })
  describe('when a send-only bus with a persistence that is not durable or shared schedules a message', () => {
    let bus: BusInstance
    let error: unknown

    beforeAll(async () => {
      bus = Bus.configure().withLogger(silentLogger).asSendOnly().build()
      await bus.initialize()
      try {
        await bus.send(new TestCommand(), { deliverAfter: 1_000 })
      } catch (e) {
        error = e
      }
    })

    afterAll(async () => bus.dispose())

    it('should throw DelayedDeliveryNotSupported, since no bus would ever send it', () => {
      expect(error).toBeInstanceOf(DelayedDeliveryNotSupported)
      const notSupported = error as DelayedDeliveryNotSupported
      expect(notSupported.reason).toEqual(
        DelayedDeliveryUnsupportedReason.NeverSent
      )
      expect(notSupported.help).toContain('durable persistence')
    })
  })

  describe('when a bus with a receiver and a persistence that is not durable or shared schedules a message', () => {
    let bus: BusInstance
    let error: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withReceiver(Mock.ofType<Receiver>().object)
        .build()
      await bus.initialize()
      try {
        await bus.publish(new TestEvent(), { deliverAfter: 1_000 })
      } catch (e) {
        error = e
      }
    })

    afterAll(async () => bus.dispose())

    it('should throw DelayedDeliveryNotSupported', () => {
      expect(error).toBeInstanceOf(DelayedDeliveryNotSupported)
      expect((error as DelayedDeliveryNotSupported).reason).toEqual(
        DelayedDeliveryUnsupportedReason.NeverSent
      )
    })
  })

  describe('when two messages are scheduled with the same messageId', () => {
    const logger = Mock.ofType<Logger>()
    const persistence = new InMemoryPersistence()
    let bus: BusInstance
    let stored: unknown[]

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(() => logger.object)
        .withPersistence(persistence)
        .build()
      await bus.initialize()
      await bus.send(new TestCommand(), {
        deliverAfter: 60_000,
        messageId: 'same-id'
      })
      await bus.send(new TestCommand(), {
        deliverAfter: 60_000,
        messageId: 'same-id'
      })
      stored = await persistence.claimDueOutgoingMessages(10, 1, 1, END_OF_TIME)
    })

    afterAll(async () => bus.dispose())

    it('should store the first only', () => {
      expect(stored).toHaveLength(1)
    })

    it('should warn that the second was not stored', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(message => message.includes('same messageId')),
            It.isObjectWith({ duplicateIds: ['same-id'] })
          ),
        Times.once()
      )
    })
  })

  describe('when buses that share a persistence are disposed', () => {
    const persistence = new CountingPersistence()
    let disposedAfterFirstBusTwice: number
    let disposedAfterReceivingBus: number

    beforeAll(async () => {
      const sendOnlyBus = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(persistence)
        .asSendOnly()
        .build()
      const receivingBus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(fastQueue())
        .withPersistence(persistence)
        .withHandler(handlerFor(TestCommand, async () => undefined))
        .build()
      const otherBus = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(persistence)
        .build()
      await sendOnlyBus.initialize()
      await receivingBus.initialize()
      await receivingBus.start()
      await otherBus.initialize()

      await otherBus.dispose()
      await otherBus.dispose()
      disposedAfterFirstBusTwice = persistence.disposeCount
      await receivingBus.dispose()
      disposedAfterReceivingBus = persistence.disposeCount
      await sendOnlyBus.dispose()
    })

    it('should count a bus disposed twice once', () => {
      expect(disposedAfterFirstBusTwice).toEqual(0)
    })

    it('should count a send-only bus as a user of the persistence', () => {
      expect(disposedAfterReceivingBus).toEqual(0)
    })

    it('should dispose the persistence once the last bus is disposed', () => {
      expect(persistence.disposeCount).toEqual(1)
    })
  })
  describe('when a bus has dispatching turned off', () => {
    const persistence = new ClaimCountingPersistence()
    let bus: BusInstance
    let stored: unknown[]

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(fastQueue())
        .withPersistence(persistence)
        .withDelayedDelivery({ dispatch: false })
        .withHandler(handlerFor(TestCommand, async () => undefined))
        .build()
      // Another bus uses the persistence, as a dedicated scheduler would
      const scheduler = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(persistence)
        .withDelayedDelivery({ dispatch: false })
        .build()
      await bus.initialize()
      await bus.start()
      await bus.send(new TestCommand(), { deliverAfter: 50 })
      await sleep(1_200)
      stored = await persistence.claimDueOutgoingMessages(10, 1, 1, END_OF_TIME)
      await scheduler.dispose()
    })

    afterAll(async () => bus.dispose())

    it('should not claim scheduled messages', () => {
      expect(persistence.claims).toEqual(0)
    })

    it('should still store the messages it schedules', () => {
      expect(stored).toHaveLength(1)
    })
  })

  describe('when a bus with dispatching turned off and a persistence that is not durable or shared schedules a message', () => {
    let bus: BusInstance
    let error: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(silentLogger)
        .withDelayedDelivery({ dispatch: false })
        .build()
      await bus.initialize()
      try {
        await bus.send(new TestCommand(), { deliverAfter: 1_000 })
      } catch (e) {
        error = e
      }
    })

    afterAll(async () => bus.dispose())

    it('should throw DelayedDeliveryNotSupported', () => {
      expect(error).toBeInstanceOf(DelayedDeliveryNotSupported)
      expect((error as DelayedDeliveryNotSupported).reason).toEqual(
        DelayedDeliveryUnsupportedReason.NeverSent
      )
    })
  })

  describe('when a bus is started as a scheduler', () => {
    const persistence = new InMemoryPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()
    const schedulerQueue = new ReadCountingQueue(message =>
      dispatched.object(message)
    )
    let service: BusInstance
    let scheduler: BusInstance

    beforeAll(async () => {
      service = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(fastQueue())
        .withPersistence(persistence)
        .withDelayedDelivery({ dispatch: false })
        .withHandler(handlerFor(TestCommand, async () => undefined))
        .build()
      // No message types: it sends stored messages as they were stored
      scheduler = Bus.configure()
        .withLogger(silentLogger)
        .withTransport(schedulerQueue)
        .withPersistence(persistence)
        .asScheduler()
        .build()
      await service.initialize()
      await service.start()
      await scheduler.initialize()
      await scheduler.start()

      const sent = new Promise<void>(resolve =>
        dispatched.setup(d => d(It.isAny())).callback(() => resolve())
      )
      await service.send(new TestCommand(), { deliverAfter: 100 })
      await sent
    })

    afterAll(async () => {
      await service.dispose()
      await scheduler.dispose()
    })

    it('should send the scheduled message through its transport', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestCommand.NAME })),
        Times.once()
      )
    })

    it('should not read from a queue', () => {
      expect(schedulerQueue.reads).toEqual(0)
    })

    it('should initialize its transport as send-only', () => {
      expect(schedulerQueue.initializedSendOnly).toEqual(true)
    })
  })
  describe('when a bus is configured as a scheduler and something else', () => {
    it.each<[string, () => BusConfiguration]>([
      [
        'with a handler',
        () =>
          Bus.configure()
            .asScheduler()
            .withHandler(handlerFor(TestCommand, async () => undefined))
      ],
      ['as send-only', () => Bus.configure().asScheduler().asSendOnly()],
      [
        'with dispatching turned off',
        () =>
          Bus.configure().asScheduler().withDelayedDelivery({ dispatch: false })
      ]
    ])('should throw InvalidOperation when built %s', (_, configure) => {
      expect(() => configure().build()).toThrow(InvalidOperation)
    })
  })

  describe('when a scheduler has a persistence that does not store outgoing messages', () => {
    let error: unknown

    beforeAll(async () => {
      const scheduler = Bus.configure()
        .withLogger(silentLogger)
        .withPersistence(new WorkflowOnlyPersistence())
        .asScheduler()
        .build()
      try {
        await scheduler.initialize()
      } catch (e) {
        error = e
      }
      await scheduler.dispose()
    })

    it('should throw DelayedDeliveryNotSupported when initialized', () => {
      expect(error).toBeInstanceOf(DelayedDeliveryNotSupported)
    })
  })
})
