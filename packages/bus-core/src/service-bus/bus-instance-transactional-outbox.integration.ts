import { Event, Message, MessageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  OutgoingMessageDropped,
  OutgoingMessageDropReason
} from '../middleware'
import { OutboxNotEnabled, OutboxNotSupported } from '../outbox'
import { deadLetter, MessageFailure, retry } from '../recoverability'
import { JsonSerializer } from '../serialization'
import {
  messageTypesFor,
  RecordingInMemoryQueue,
  testMessageTypes
} from '../test'
import { TestCommand } from '../test/test-command'
import { TestEvent } from '../test/test-event'
import { TransportSendOptions } from '../transport'
import {
  defineWorkflow,
  InMemoryPersistence,
  Persistence,
  PersistenceTransaction,
  WorkflowState
} from '../workflow'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'
import { InvalidOperation } from './error'

jest.setTimeout(20_000)

const silentLogger = () => Mock.ofType<Logger>().object

class OutboxWorkflowState extends WorkflowState {
  static NAME = 'OutboxWorkflowState'
  $name = OutboxWorkflowState.NAME
  started: boolean
}

class LookupWorkflowState extends WorkflowState {
  static NAME = 'LookupWorkflowState'
  $name = LookupWorkflowState.NAME
  value: string
}

const outboxMessageTypes = [
  testMessageTypes,
  messageTypesFor(OutboxWorkflowState)
]

/**
 * A persistence that stores workflow state but can't run transactions or store messages
 */
class WorkflowOnlyPersistence implements Persistence {
  prepare(): void {}
  async getWorkflowState(): Promise<never[]> {
    return []
  }
  async saveWorkflowState(): Promise<void> {}
}

/**
 * An in-memory persistence that counts how its transactions end, and can fail the next commit
 */
class CountingPersistence extends InMemoryPersistence {
  commits = 0
  rollbacks = 0
  failNextCommit = false

  async beginTransaction(): Promise<PersistenceTransaction> {
    const transaction = await super.beginTransaction()
    return {
      ...transaction,
      commit: async () => {
        if (this.failNextCommit) {
          this.failNextCommit = false
          await transaction.rollback()
          throw new Error('Commit failed')
        }
        await transaction.commit()
        this.commits++
      },
      rollback: async () => {
        await transaction.rollback()
        this.rollbacks++
      }
    }
  }

  /**
   * The messages left in the store, whenever they're due
   */
  async storedMessageCount(): Promise<number> {
    const farFuture = new Date(Date.now() + 24 * 60 * 60_000)
    const claimed = await this.claimDueOutgoingMessages(
      100,
      60_000,
      60_000,
      farFuture
    )
    await this.releaseOutgoingMessages(
      claimed.map(({ id, attempts }) => ({ id, attempts: attempts! }))
    )
    return claimed.length
  }
}

/**
 * A recording queue whose next publish fails, like a broker that's briefly unavailable
 */
class FailingPublishQueue extends RecordingInMemoryQueue {
  failNextPublish = true

  async publish<TEvent extends Event>(
    event: TEvent,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    if (this.failNextPublish) {
      this.failNextPublish = false
      throw new Error('Broker unavailable')
    }
    await super.publish(event, messageOptions, sendOptions)
  }
}

/**
 * A recording queue whose publish of a `TestEvent` of `hangs` never finishes, like a broker that stopped answering
 */
class HangingPublishQueue extends RecordingInMemoryQueue {
  async publish<TEvent extends Event>(
    event: TEvent,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    if ((event as unknown as TestEvent).property1 === 'hangs') {
      return new Promise<void>(() => undefined)
    }
    await super.publish(event, messageOptions, sendOptions)
  }
}

/**
 * A serializer that can't convert a `TestEvent` of `unserializable`, like one with a circular reference
 */
class UnserializableEventSerializer extends JsonSerializer {
  toPlain<T extends object>(obj: T): object {
    if (obj instanceof TestEvent && obj.property1 === 'unserializable') {
      throw new TypeError('Converting circular structure to JSON')
    }
    return super.toPlain(obj)
  }
}

describe('BusInstance transactional outbox', () => {
  describe('when withOutbox() is configured with a persistence that has no transactions', () => {
    let error: unknown

    beforeAll(() => {
      try {
        Bus.configure()
          .withLogger(silentLogger)
          .withPersistence(new WorkflowOnlyPersistence())
          .withOutbox()
          .build()
      } catch (e) {
        error = e
      }
    })

    it('should throw OutboxNotSupported naming the persistence', () => {
      expect(error).toBeInstanceOf(OutboxNotSupported)
      expect((error as OutboxNotSupported).persistenceName).toEqual(
        'WorkflowOnlyPersistence'
      )
    })
  })

  describe('when the handlers of a message succeed', () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()
    const transactions: Record<string, unknown> = {}

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(message =>
        dispatched.object(message)
      )
      bus = Bus.configure()
        .withMessageTypes(...outboxMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withMiddleware({
          incoming: async (context, next) => {
            transactions.incoming = context.transaction
            await next()
          },
          handler: async (context, next) => {
            transactions[`${context.handlerName}Middleware`] =
              context.transaction
            await next()
          }
        })
        .withWorkflow(
          defineWorkflow(OutboxWorkflowState).startedBy(
            TestCommand,
            async (_message, _state, ctx) => {
              transactions.workflow = ctx.transaction
              await ctx.publish(new TestEvent('workflow'))
              return { started: true }
            }
          )
        )
        .withHandler(
          handlerFor(TestCommand, async function handler(_m, _a, ctx) {
            transactions.handler = ctx.transaction
            await ctx.publish(new TestEvent('handler'))
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const deleted = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      await deleted
    })

    afterAll(async () => bus.dispose())

    it('should send what every handler sent', () => {
      dispatched.verify(
        d => d(It.isObjectWith<TestEvent>({ property1: 'handler' })),
        Times.once()
      )
      dispatched.verify(
        d => d(It.isObjectWith<TestEvent>({ property1: 'workflow' })),
        Times.once()
      )
    })

    it('should save the workflow state', () => {
      expect(persistence.length(OutboxWorkflowState)).toEqual(1)
    })

    it('should commit one transaction', () => {
      expect(persistence.commits).toEqual(1)
      expect(persistence.rollbacks).toEqual(0)
    })

    it('should give every handler and handler middleware the same transaction', () => {
      const {
        handler,
        handlerMiddleware,
        workflow,
        OutboxWorkflowStateMiddleware
      } = transactions
      expect(handler).toBeDefined()
      expect([
        handlerMiddleware,
        workflow,
        OutboxWorkflowStateMiddleware
      ]).toEqual([handler, handler, handler])
    })

    it('should not give incoming middleware the transaction', () => {
      expect(transactions.incoming).toBeUndefined()
    })

    it('should delete the messages from the store once they are sent', async () => {
      expect(await persistence.storedMessageCount()).toEqual(0)
    })
  })

  describe('when one handler of a message fails', () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { receiveTimeoutMs: 100 }
      )
      bus = Bus.configure()
        .withMessageTypes(...outboxMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withRecoverability(() => deadLetter())
        .withOutbox()
        .withWorkflow(
          defineWorkflow(OutboxWorkflowState).startedBy(TestCommand, () => ({
            started: true
          }))
        )
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent('sibling'))
          })
        )
        .withHandler(
          handlerFor(TestCommand, async () => {
            throw new Error('Handler failed')
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const failed = once(queue.settled, 'failed')
      await bus.send(new TestCommand())
      await failed
    })

    afterAll(async () => bus.dispose())

    it('should not send what the other handlers sent', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent.NAME })),
        Times.never()
      )
    })

    it('should not save the workflow state', () => {
      expect(persistence.length(OutboxWorkflowState)).toEqual(0)
    })

    it('should roll the transaction back', () => {
      expect(persistence.commits).toEqual(0)
      expect(persistence.rollbacks).toEqual(1)
    })

    it('should store nothing', async () => {
      expect(await persistence.storedMessageCount()).toEqual(0)
    })
  })

  describe('when a handler calls failMessage()', () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { receiveTimeoutMs: 100 }
      )
      bus = Bus.configure()
        .withMessageTypes(...outboxMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent('failed'))
            await ctx.failMessage()
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const failed = once(queue.settled, 'failed')
      await bus.send(new TestCommand())
      await failed
    })

    afterAll(async () => bus.dispose())

    it('should not send what the handler sent', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent.NAME })),
        Times.never()
      )
    })

    it('should roll the transaction back', () => {
      expect(persistence.commits).toEqual(0)
      expect(persistence.rollbacks).toEqual(1)
    })
  })

  describe('when a message fails to send after the transaction is committed', () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const dispatched =
      Mock.ofType<
        (message: Message, attributes: MessageAttributes | undefined) => void
      >()
    const handled = Mock.ofType<() => void>()
    const returned = Mock.ofType<() => void>()
    let sentMessageId: string | undefined
    let dispatchOutcome: Promise<unknown> | undefined

    beforeAll(async () => {
      const events = new EventEmitter()
      const queue = new FailingPublishQueue((message, attributes) => {
        dispatched.object(message, attributes)
        if (message.$name === TestEvent.NAME) {
          events.emit('published')
        }
      })
      queue.settled.on('returned', () => returned.object())
      bus = Bus.configure()
        .withMessageTypes(...outboxMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withMiddleware({
          outgoing: async (context, next) => {
            sentMessageId = context.attributes.messageId
            if (context.message.$name === TestEvent.NAME) {
              dispatchOutcome = context.dispatched.then(
                () => 'dispatched',
                (error: unknown) => error
              )
            }
            await next()
          }
        })
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            handled.object()
            await ctx.publish(new TestEvent('retried-by-dispatcher'))
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const published = once(events, 'published')
      await bus.send(new TestCommand())
      await published
    })

    afterAll(async () => bus.dispose())

    it('should still send it, from the store', () => {
      dispatched.verify(
        d =>
          d(
            It.isObjectWith<TestEvent>({ property1: 'retried-by-dispatcher' }),
            It.isObjectWith<MessageAttributes>({ messageId: sentMessageId })
          ),
        Times.once()
      )
    })

    it('should not handle the message again', () => {
      handled.verify(h => h(), Times.once())
      returned.verify(r => r(), Times.never())
    })

    it('should resolve its dispatched promise at the commit, since it is kept to send', async () => {
      expect(await dispatchOutcome).toEqual('dispatched')
    })

    it('should delete it from the store once it is sent', async () => {
      expect(await persistence.storedMessageCount()).toEqual(0)
    })
  })

  describe('when the transaction fails to commit', () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()
    const handled = Mock.ofType<() => void>()
    const returned = Mock.ofType<() => void>()
    const dispatchOutcomes: Promise<unknown>[] = []

    beforeAll(async () => {
      persistence.failNextCommit = true
      const queue = new RecordingInMemoryQueue(message =>
        dispatched.object(message)
      )
      queue.settled.on('returned', () => returned.object())
      bus = Bus.configure()
        .withMessageTypes(...outboxMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withRecoverability(({ failedAttempts }) =>
          failedAttempts < 2 ? retry(0) : deadLetter()
        )
        .withOutbox()
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestEvent.NAME) {
              dispatchOutcomes.push(
                context.dispatched.then(
                  () => 'dispatched',
                  (error: unknown) => error
                )
              )
            }
            await next()
          }
        })
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            handled.object()
            await ctx.publish(new TestEvent('after-commit'))
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const deleted = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      await deleted
    })

    it("should reject the failed attempt's dispatched as transaction-failed, and resolve the retry's", async () => {
      const [failedAttempt, retry] = await Promise.all(dispatchOutcomes)
      expect(failedAttempt).toBeInstanceOf(OutgoingMessageDropped)
      expect(failedAttempt).toMatchObject({
        reason: OutgoingMessageDropReason.TransactionFailed
      })
      expect(retry).toEqual('dispatched')
    })

    afterAll(async () => bus.dispose())

    it('should retry the message', () => {
      handled.verify(h => h(), Times.exactly(2))
      returned.verify(r => r(), Times.once())
    })

    it('should only send what the attempt that committed sent', () => {
      dispatched.verify(
        d => d(It.isObjectWith<TestEvent>({ property1: 'after-commit' })),
        Times.once()
      )
    })
  })

  describe('when a handler sends a message with deliverAfter', () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()
    let publishedBeforeDue: number

    beforeAll(async () => {
      const events = new EventEmitter()
      let published = 0
      const queue = new RecordingInMemoryQueue(message => {
        dispatched.object(message)
        if (message.$name === TestEvent.NAME) {
          published++
          events.emit('published')
        }
      })
      bus = Bus.configure()
        .withMessageTypes(...outboxMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent('delayed'), { deliverAfter: 300 })
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const deleted = once(queue.settled, 'deleted')
      const delayedPublished = once(events, 'published')
      await bus.send(new TestCommand())
      await deleted
      publishedBeforeDue = published
      await delayedPublished
    })

    afterAll(async () => bus.dispose())

    it('should not send it before it is due', () => {
      expect(publishedBeforeDue).toEqual(0)
    })

    it('should send it once it is due', () => {
      dispatched.verify(
        d => d(It.isObjectWith<TestEvent>({ property1: 'delayed' })),
        Times.once()
      )
    })
  })

  describe('when bus.transaction() is called', () => {
    describe('without withOutbox()', () => {
      let bus: BusInstance
      let error: unknown

      beforeAll(async () => {
        bus = Bus.configure().withLogger(silentLogger).build()
        await bus.initialize()
        error = await bus
          .transaction(async () => undefined)
          .catch((e: unknown) => e)
      })

      afterAll(async () => bus.dispose())

      it('should throw OutboxNotEnabled', () => {
        expect(error).toBeInstanceOf(OutboxNotEnabled)
      })
    })

    describe('before the bus is initialized', () => {
      let bus: BusInstance
      let error: unknown

      beforeAll(async () => {
        bus = Bus.configure()
          .withLogger(silentLogger)
          .withPersistence(new InMemoryPersistence())
          .withOutbox()
          .build()
        error = await bus
          .transaction(async () => undefined)
          .catch((e: unknown) => e)
      })

      afterAll(async () => bus.dispose())

      it('should throw InvalidOperation', () => {
        expect(error).toBeInstanceOf(InvalidOperation)
      })
    })

    describe('and the work resolves', () => {
      let bus: BusInstance
      const persistence = new CountingPersistence()
      const dispatched = Mock.ofType<(message: Message) => void>()
      let result: string
      let transaction: unknown

      beforeAll(async () => {
        bus = Bus.configure()
          .withLogger(silentLogger)
          .withTransport(
            new RecordingInMemoryQueue(message => dispatched.object(message))
          )
          .withPersistence(persistence)
          .withOutbox()
          .asSendOnly()
          .build()
        await bus.initialize()
        result = await bus.transaction(async ctx => {
          transaction = ctx.transaction
          await ctx.publish(new TestEvent('transaction'))
          dispatched.verify(d => d(It.isAny()), Times.never())
          return 'result'
        })
      })

      afterAll(async () => bus.dispose())

      it('should return what the work returned', () => {
        expect(result).toEqual('result')
      })

      it('should give the work the transaction', () => {
        expect(transaction).toBeDefined()
      })

      it('should commit the transaction', () => {
        expect(persistence.commits).toEqual(1)
      })

      it('should send what the work sent once it is committed', () => {
        dispatched.verify(
          d => d(It.isObjectWith<TestEvent>({ property1: 'transaction' })),
          Times.once()
        )
      })
    })

    describe('and the work throws', () => {
      let bus: BusInstance
      const persistence = new CountingPersistence()
      const dispatched = Mock.ofType<(message: Message) => void>()
      const workError = new Error('Work failed')
      let error: unknown

      beforeAll(async () => {
        bus = Bus.configure()
          .withLogger(silentLogger)
          .withTransport(
            new RecordingInMemoryQueue(message => dispatched.object(message))
          )
          .withPersistence(persistence)
          .withOutbox()
          .asSendOnly()
          .build()
        await bus.initialize()
        error = await bus
          .transaction(async ctx => {
            await ctx.publish(new TestEvent('rolled-back'))
            throw workError
          })
          .catch((e: unknown) => e)
      })

      afterAll(async () => bus.dispose())

      it('should throw the error of the work', () => {
        expect(error).toBe(workError)
      })

      it('should roll the transaction back', () => {
        expect(persistence.rollbacks).toEqual(1)
        expect(persistence.commits).toEqual(0)
      })

      it('should not send what the work sent', () => {
        dispatched.verify(d => d(It.isAny()), Times.never())
      })
    })

    describe('inside a handler', () => {
      let bus: BusInstance
      const persistence = new CountingPersistence()
      const dispatched = Mock.ofType<(message: Message) => void>()
      let handlerTransaction: unknown
      let workTransaction: unknown

      beforeAll(async () => {
        const queue = new RecordingInMemoryQueue(message =>
          dispatched.object(message)
        )
        bus = Bus.configure()
          .withMessageTypes(testMessageTypes)
          .withLogger(silentLogger)
          .withTransport(queue)
          .withPersistence(persistence)
          .withOutbox()
          .withHandler(
            handlerFor(TestCommand, async (_m, _a, ctx) => {
              handlerTransaction = ctx.transaction
              await bus.transaction(async transactionContext => {
                workTransaction = transactionContext.transaction
                await transactionContext.publish(new TestEvent('joined'))
              })
            })
          )
          .build()

        await bus.initialize()
        await bus.start()
        const deleted = once(queue.settled, 'deleted')
        await bus.send(new TestCommand())
        await deleted
      })

      afterAll(async () => bus.dispose())

      it("should run the work in the handler's transaction", () => {
        expect(workTransaction).toBeDefined()
        expect(workTransaction).toBe(handlerTransaction)
      })

      it('should commit it once, with the handler', () => {
        expect(persistence.commits).toEqual(1)
      })

      it('should send what the work sent', () => {
        dispatched.verify(
          d => d(It.isObjectWith<TestEvent>({ property1: 'joined' })),
          Times.once()
        )
      })
    })
  })

  describe('when a stored reply has no destination', () => {
    let bus: BusInstance
    const replyId = randomUUID()
    let loggedError: object | undefined

    beforeAll(async () => {
      const persistence = new InMemoryPersistence()
      await persistence.storeOutgoingMessages([
        {
          id: replyId,
          kind: 'reply',
          message: { $name: TestEvent.NAME, $version: 1 },
          attributes: { attributes: {}, stickyAttributes: {} },
          headers: {},
          dueAt: new Date(0)
        }
      ])
      const logger = Mock.ofType<Logger>()
      const warned = new Promise<void>(resolve => {
        logger
          .setup(l => l.warn(It.isAnyString(), It.isAny()))
          .callback((_message: string, context?: { error?: object }) => {
            if (context?.error) {
              loggedError = context.error
              resolve()
            }
          })
      })
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(() => logger.object)
        .withTransport(new RecordingInMemoryQueue(() => undefined))
        .withPersistence(persistence)
        .withOutbox()
        .build()
      await bus.initialize()
      await bus.start()
      await warned
    })

    afterAll(async () => bus.dispose())

    it('should fail to send it with OutgoingMessageDestinationMissing', () => {
      expect(loggedError).toMatchObject({
        message: expect.stringContaining('has no destination') as string,
        messageId: replyId,
        messageName: TestEvent.NAME
      })
    })
  })

  describe("when a message the handlers sent can't be converted to store it", () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { receiveTimeoutMs: 100 }
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withSerializer(new UnserializableEventSerializer())
        .withRecoverability(() => deadLetter())
        .withOutbox()
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            await ctx.publish(new TestEvent('unserializable'))
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const failed = once(queue.settled, 'failed')
      await bus.send(new TestCommand())
      await failed
    })

    afterAll(async () => bus.dispose())

    it('should roll the transaction back rather than leave it open', () => {
      expect(persistence.rollbacks).toEqual(1)
      expect(persistence.commits).toEqual(0)
    })

    it('should send nothing', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent.NAME })),
        Times.never()
      )
    })
  })

  describe('when work joined to a handler with bus.transaction() throws, and the handler catches the error', () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const dispatched = Mock.ofType<(message: Message) => void>()
    let failure: MessageFailure
    let dispatchOutcome: Promise<unknown> | undefined

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(
        message => dispatched.object(message),
        { receiveTimeoutMs: 100 }
      )
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withRecoverability(() => deadLetter())
        .withOutbox()
        .withMiddleware({
          outgoing: async (context, next) => {
            if (context.message.$name === TestEvent.NAME) {
              dispatchOutcome = context.dispatched.then(
                () => 'dispatched',
                (error: unknown) => error
              )
            }
            await next()
          }
        })
        .withHandler(
          handlerFor(TestCommand, async () => {
            await bus
              .transaction(async ctx => {
                await ctx.publish(new TestEvent('joined'))
                throw new Error('Work failed')
              })
              .catch(() => undefined)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const failed = once(queue.settled, 'failed')
      await bus.send(new TestCommand())
      ;[, failure] = (await failed) as [unknown, MessageFailure]
    })

    afterAll(async () => bus.dispose())

    it("should reject the work's dispatched promise as transaction-work-failed", async () => {
      expect(await dispatchOutcome).toMatchObject({
        reason: OutgoingMessageDropReason.TransactionWorkFailed
      })
    })

    it('should fail the message with TransactionRolledBack', () => {
      expect(failure.error.message).toContain(
        'because work given to bus.transaction() inside it threw'
      )
    })

    it('should roll the transaction back', () => {
      expect(persistence.rollbacks).toEqual(1)
      expect(persistence.commits).toEqual(0)
    })

    it('should not send what the work sent', () => {
      dispatched.verify(
        d => d(It.isObjectWith<Message>({ $name: TestEvent.NAME })),
        Times.never()
      )
    })
  })

  describe('when a message takes too long to send after the transaction is committed', () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const handled = Mock.ofType<() => void>()
    let storedMessagesOnceHandled: number

    beforeAll(async () => {
      const queue = new HangingPublishQueue(() => undefined)
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withDelayedDelivery({ dispatch: false })
        .withHandler(
          handlerFor(TestCommand, async (_m, _a, ctx) => {
            handled.object()
            await ctx.publish(new TestEvent('hangs'))
          })
        )
        .withConcurrency(1)
        .build()

      await bus.initialize()
      await bus.start()
      const deleted = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      await deleted
      storedMessagesOnceHandled = await persistence.storedMessageCount()
    }, 30_000)

    afterAll(async () => bus.dispose())

    it('should stop waiting for it, and finish handling the message', () => {
      handled.verify(h => h(), Times.once())
    })

    it('should leave it in the store, to be sent again if it is never sent', () => {
      expect(storedMessagesOnceHandled).toEqual(1)
    })
  })

  describe("when a workflow message's lookup has no value, in the message's transaction", () => {
    let bus: BusInstance
    const persistence = new CountingPersistence()
    const matched = Mock.ofType<() => void>()

    beforeAll(async () => {
      const queue = new RecordingInMemoryQueue(() => undefined)
      bus = Bus.configure()
        .withMessageTypes(
          testMessageTypes,
          messageTypesFor(LookupWorkflowState)
        )
        .withLogger(silentLogger)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withWorkflow(
          defineWorkflow(LookupWorkflowState)
            // An empty mapped field, which an empty lookup value would match without the guard
            .startedBy(TestCommand, () => ({ value: '' }))
            .when(TestEvent, { lookup: () => '', mapsTo: 'value' }, () => {
              matched.object()
              return {}
            })
        )
        .build()

      await bus.initialize()
      await bus.start()
      const started = once(queue.settled, 'deleted')
      await bus.send(new TestCommand())
      await started
      const handled = once(queue.settled, 'deleted')
      await bus.publish(new TestEvent('empty-lookup'))
      await handled
    })

    afterAll(async () => bus.dispose())

    it('should match no workflow instance, even one whose mapped field is empty', () => {
      expect(persistence.length(LookupWorkflowState)).toEqual(1)
      matched.verify(m => m(), Times.never())
    })
  })
})
