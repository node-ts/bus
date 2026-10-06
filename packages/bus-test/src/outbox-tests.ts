import {
  Bus,
  BusInstance,
  deadLetter,
  defineWorkflow,
  handlerFor,
  InMemoryQueue,
  Logger,
  MessageWorkflowMapping,
  Persistence,
  retry,
  TransportSendOptions
} from '@node-ts/bus-core'
import { Event, Message, MessageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Mock } from 'typemoq'
import {
  messageTypes,
  TestOutboxCommand,
  TestOutboxEvent,
  TestOutboxWorkflowState
} from './helpers'

/**
 * How many times the suite's bus tries a message before it dead-letters it
 */
const MAX_ATTEMPTS = 3

const ATTRIBUTES: MessageAttributes = { attributes: {}, stickyAttributes: {} }

const runIdMapping: MessageWorkflowMapping<
  TestOutboxCommand,
  TestOutboxWorkflowState
> = {
  lookup: message => message.runId,
  mapsTo: 'runId'
}

/**
 * An in-memory queue that can fail the next publish or reply of a run's events, like a broker that's briefly
 * unavailable
 */
class OutboxTestQueue extends InMemoryQueue {
  private readonly runIdsToFail = new Set<string>()

  /**
   * Fails the next publish or reply of a `TestOutboxEvent` of a run
   */
  failNextSend(runId: string): void {
    this.runIdsToFail.add(runId)
  }

  async publish<TEvent extends Event>(
    event: TEvent,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    this.failIfAsked(event)
    await super.publish(event, messageOptions, sendOptions)
  }

  async sendToAddress(
    address: string,
    message: Message,
    messageOptions?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    this.failIfAsked(message)
    await super.sendToAddress(address, message, messageOptions, sendOptions)
  }

  private failIfAsked(message: Message): void {
    if (
      message.$name === TestOutboxEvent.NAME &&
      this.runIdsToFail.delete((message as TestOutboxEvent).runId)
    ) {
      throw new Error('Broker unavailable')
    }
  }
}

/**
 * A suite that checks a persistence keeps the guarantees of `withOutbox()`: the workflow state and outgoing messages
 * of a message are kept together or not at all, a handler that fails leaves nothing behind for its retry to repeat,
 * a message or reply the transport fails to send after the transaction is committed is still sent, and
 * `bus.transaction()` sends its messages only once it's committed.
 *
 * It runs a bus with an in-memory queue, a workflow and handlers that fail on purpose. The bus provisions with
 * `bus.provision()`, then initializes without provisioning, so `initialize()` only checks that what `provision()`
 * created exists.
 * @param persistence A fully configured persistence that supports `withOutbox()`, on its own database or schema,
 * since the suite's bus sends the outgoing messages it finds in it. It's disposed when the suite's bus is disposed,
 * unless another bus that uses it is still running.
 */
export const outboxTests = (persistence: Persistence): void => {
  const events = new EventEmitter()
  const received: TestOutboxEvent[] = []
  const handledCommands: string[] = []
  const runIdsThatFailedOnce = new Set<string>()
  const queue = new OutboxTestQueue({ receiveTimeoutMs: 100 })
  let bus: BusInstance

  /**
   * Resolves once `eventName` is emitted with a run id
   */
  const waitFor = async (eventName: string, runId: string): Promise<void> =>
    new Promise(resolve => {
      const listener = (emittedRunId: string) => {
        if (emittedRunId === runId) {
          events.off(eventName, listener)
          resolve()
        }
      }
      events.on(eventName, listener)
    })

  /**
   * Publishes an event outside a handler and waits for it to be received, so every event sent before it has been
   * received too
   */
  const drainQueue = async (): Promise<void> => {
    const markerRunId = randomUUID()
    const markerReceived = waitFor('received', markerRunId)
    await bus.publish(new TestOutboxEvent(markerRunId, 'marker'))
    await markerReceived
  }

  const receivedFrom = (runId: string, source: string): TestOutboxEvent[] =>
    received.filter(event => event.runId === runId && event.source === source)

  const workflowStateOf = async (
    runId: string
  ): Promise<TestOutboxWorkflowState[]> =>
    persistence.getWorkflowState(
      TestOutboxWorkflowState,
      runIdMapping,
      new TestOutboxCommand(runId, 'lookup'),
      ATTRIBUTES,
      true
    )

  describe('when messages are handled with withOutbox()', () => {
    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(messageTypes)
        .withTransport(queue)
        .withPersistence(persistence)
        .withOutbox()
        .withRecoverability(({ message, failedAttempts }) => {
          if (failedAttempts < MAX_ATTEMPTS) {
            return retry(0)
          }
          events.emit('dead-lettered', (message as TestOutboxCommand).runId)
          return deadLetter()
        })
        .withWorkflow(
          defineWorkflow(TestOutboxWorkflowState).startedBy(
            TestOutboxCommand,
            ({ runId }) => ({ runId })
          )
        )
        .withHandler(
          handlerFor(
            TestOutboxCommand,
            async ({ runId, scenario }, _attributes, ctx) => {
              if (scenario === 'reply') {
                await ctx.reply(new TestOutboxEvent(runId, 'reply'))
              } else {
                await ctx.publish(new TestOutboxEvent(runId, 'sibling'))
              }
            }
          )
        )
        .withHandler(
          handlerFor(TestOutboxCommand, ({ runId, scenario }) => {
            handledCommands.push(runId)
            if (scenario === 'fail') {
              throw new Error('Handler failed')
            }
            if (scenario === 'fail-once' && !runIdsThatFailedOnce.has(runId)) {
              runIdsThatFailedOnce.add(runId)
              throw new Error('Handler failed once')
            }
          })
        )
        .withHandler(
          handlerFor(TestOutboxEvent, event => {
            received.push(event)
            events.emit('received', event.runId)
          })
        )
        .build()
      // Provisioned as a deploy would, so initialize() only checks the persistence's storage exists
      await bus.provision()
      await bus.initialize()
      await bus.start()
    })

    afterAll(async () => bus.dispose())

    describe('and a handler fails every time', () => {
      const runId = randomUUID()

      beforeAll(async () => {
        const deadLettered = waitFor('dead-lettered', runId)
        await bus.send(new TestOutboxCommand(runId, 'fail'))
        await deadLettered
        await drainQueue()
      })

      it('should try the message until it is dead-lettered', () => {
        expect(handledCommands.filter(id => id === runId)).toHaveLength(
          MAX_ATTEMPTS
        )
      })

      it('should not send what the other handlers sent', () => {
        expect(receivedFrom(runId, 'sibling')).toHaveLength(0)
      })

      it('should not save the workflow state', async () => {
        expect(await workflowStateOf(runId)).toHaveLength(0)
      })
    })

    describe('and a handler fails once', () => {
      const runId = randomUUID()

      beforeAll(async () => {
        const siblingReceived = waitFor('received', runId)
        await bus.send(new TestOutboxCommand(runId, 'fail-once'))
        await siblingReceived
        await drainQueue()
      })

      it('should handle the message again', () => {
        expect(handledCommands.filter(id => id === runId)).toHaveLength(2)
      })

      it('should send what the other handlers sent once', () => {
        expect(receivedFrom(runId, 'sibling')).toHaveLength(1)
      })

      it('should save the workflow state once', async () => {
        expect(await workflowStateOf(runId)).toHaveLength(1)
      })
    })

    describe('and the transport fails to send a message after the transaction is committed', () => {
      const runId = randomUUID()

      beforeAll(async () => {
        queue.failNextSend(runId)
        const siblingReceived = waitFor('received', runId)
        await bus.send(new TestOutboxCommand(runId, 'succeed'))
        await siblingReceived
        await drainQueue()
      })

      it('should still send it once', () => {
        expect(receivedFrom(runId, 'sibling')).toHaveLength(1)
      })

      it('should not handle the message again', () => {
        expect(handledCommands.filter(id => id === runId)).toHaveLength(1)
      })

      it('should save the workflow state once', async () => {
        expect(await workflowStateOf(runId)).toHaveLength(1)
      })
    })

    describe('and the transport fails to send a reply after the transaction is committed', () => {
      const runId = randomUUID()

      beforeAll(async () => {
        queue.failNextSend(runId)
        const replyReceived = waitFor('received', runId)
        await bus.send(new TestOutboxCommand(runId, 'reply'))
        await replyReceived
        await drainQueue()
      })

      it('should still send it to its destination once', () => {
        expect(receivedFrom(runId, 'reply')).toHaveLength(1)
      })

      it('should not handle the message again', () => {
        expect(handledCommands.filter(id => id === runId)).toHaveLength(1)
      })
    })

    describe('and bus.transaction() is committed', () => {
      const runId = randomUUID()
      let result: string

      beforeAll(async () => {
        const transactionReceived = waitFor('received', runId)
        result = await bus.transaction(async ctx => {
          await ctx.publish(new TestOutboxEvent(runId, 'transaction'))
          return 'committed'
        })
        await transactionReceived
        await drainQueue()
      })

      it('should return what the work returned', () => {
        expect(result).toEqual('committed')
      })

      it('should send what the work sent once', () => {
        expect(receivedFrom(runId, 'transaction')).toHaveLength(1)
      })
    })

    describe('and the work of bus.transaction() throws', () => {
      const runId = randomUUID()
      const workError = new Error('Work failed')
      let error: unknown

      beforeAll(async () => {
        error = await bus
          .transaction(async ctx => {
            await ctx.publish(new TestOutboxEvent(runId, 'transaction'))
            throw workError
          })
          .catch((e: unknown) => e)
        await drainQueue()
      })

      it('should throw the error of the work', () => {
        expect(error).toBe(workError)
      })

      it('should not send what the work sent', () => {
        expect(receivedFrom(runId, 'transaction')).toHaveLength(0)
      })
    })
  })
}
