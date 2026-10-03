import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import {
  ReceivedMessageFailure,
  ReceivedMessageReturnedToQueue,
  Receiver
} from '../receiver'
import {
  deadLetter,
  MessageFailure,
  RecoverabilityPolicy,
  retry
} from '../recoverability'
import { MessageSerializer } from '../serialization'
import {
  HandleChecker,
  TestCommand,
  TestCommand2,
  TestEvent,
  testMessageTypes
} from '../test'
import { TestCommand3 } from '../test/test-command-3'
import { InMemoryQueue, TransportMessage } from '../transport'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'
import { InvalidOperation } from './error'

const emptyAttributes: MessageAttributes = {
  attributes: {},
  stickyAttributes: {}
}

class PassthroughReceiver implements Receiver<
  Message,
  TransportMessage<unknown>
> {
  async receive(
    receivedMessage: Message | Message[],
    _messageSerializer: MessageSerializer
  ): Promise<TransportMessage<unknown> | TransportMessage<unknown>[]> {
    const toSend = Array.isArray(receivedMessage)
      ? receivedMessage
      : [receivedMessage]
    return toSend.map((domainMessage, index) => ({
      id: index.toString(),
      attributes: emptyAttributes,
      domainMessage,
      raw: domainMessage,
      failedAttempts: 0
    }))
  }
}

interface BatchResult {
  failures: { id: string | undefined; error: Error }[]
}

class BatchResultReceiver
  extends PassthroughReceiver
  implements Receiver<Message, TransportMessage<unknown>, BatchResult>
{
  toReceiveResult(failures: ReceivedMessageFailure[]): BatchResult {
    return {
      failures: failures.map(({ message, error }) => ({
        id: message.id,
        error
      }))
    }
  }
}

class ThrowingResultReceiver
  extends PassthroughReceiver
  implements Receiver<Message, TransportMessage<unknown>>
{
  toReceiveResult(): never {
    throw new InvalidOperation('Batch rejected by receiver')
  }
}

const RETRY_DELAY = 1_000

const buildBus = async (
  receiver: Receiver,
  checker: HandleChecker,
  queue: InMemoryQueue,
  recoverability: RecoverabilityPolicy = () => retry(RETRY_DELAY)
): Promise<BusInstance> => {
  const bus: BusInstance = Bus.configure()
    .withMessageTypes(testMessageTypes)
    .withReceiver(receiver)
    .withRecoverability(recoverability)
    .withHandler(
      handlerFor(TestCommand, (command: TestCommand, attributes) =>
        checker.check(command, attributes)
      )
    )
    .withHandler(
      handlerFor(TestEvent, () => {
        throw new Error()
      })
    )
    .withHandler(
      handlerFor(TestCommand3, async () => {
        await bus.returnMessage()
      })
    )
    .withTransport(queue)
    .withLogger(() => Mock.ofType<Logger>().object)
    .build()
  await bus.initialize()
  return bus
}

describe('BusInstance Receiver', () => {
  describe('when configuring Bus with a Receiver', () => {
    let bus: BusInstance
    const checker = Mock.ofType<HandleChecker>()
    const queue = Mock.ofType<InMemoryQueue>()

    beforeAll(async () => {
      bus = await buildBus(
        new PassthroughReceiver(),
        checker.object,
        queue.object
      )
    })

    afterAll(async () => {
      await bus.dispose()
    })

    describe('and bus.start() is called', () => {
      it('should throw an InvalidOperationError', async () => {
        await expect(bus.start()).rejects.toBeInstanceOf(InvalidOperation)
      })
    })

    describe('and a message is passed through to bus.receive()', () => {
      const command = new TestCommand()

      beforeAll(async () => {
        checker.reset()
        queue.reset()
        await bus.receive(command)
      })

      it('should dispatch to handlers', () => {
        checker.verify(
          c =>
            c.check(
              It.isObjectWith<Message>({ $name: TestCommand.NAME }),
              emptyAttributes
            ),
          Times.once()
        )
      })

      it('should not call delete message, as the receiver implementation should handle it', () => {
        queue.verify(q => q.deleteMessage(It.isAny()), Times.never())
      })
    })

    describe('and an error is thrown when receiving a message', () => {
      let result: Promise<unknown>

      beforeAll(async () => {
        queue.reset()
        result = bus.receive(new TestEvent())
        result.catch(() => undefined)
      })

      it('should re-throw the error so the receiver host can retry the message', async () => {
        await expect(result).rejects.toThrow()
      })

      it('should return the message to the transport with the delay from the policy', () => {
        queue.verify(
          q => q.returnMessage(It.isAny(), RETRY_DELAY),
          Times.once()
        )
      })
    })

    describe('and a handler returns the message to the queue', () => {
      let result: Promise<unknown>

      beforeAll(async () => {
        queue.reset()
        result = bus.receive(new TestCommand3())
        result.catch(() => undefined)
      })

      it('should reject so the receiver host does not delete the message', async () => {
        await expect(result).rejects.toBeInstanceOf(
          ReceivedMessageReturnedToQueue
        )
      })

      it('should return the message to the transport', () => {
        queue.verify(
          q => q.returnMessage(It.isAny(), RETRY_DELAY),
          Times.once()
        )
      })
    })

    describe('and a batch of messages are passed through to bus.receive()', () => {
      const commands = Array(10)
        .fill(undefined)
        .map(() => new TestCommand())

      beforeAll(async () => {
        checker.reset()
        await bus.receive(commands)
      })

      it('should dispatch all commands to handlers', () => {
        checker.verify(
          c =>
            c.check(
              It.isObjectWith<Message>({ $name: TestCommand.NAME }),
              emptyAttributes
            ),
          Times.exactly(commands.length)
        )
      })
    })
  })

  describe('when configuring Bus with a Receiver that reports batch results', () => {
    let bus: BusInstance
    const checker = Mock.ofType<HandleChecker>()
    const queue = Mock.ofType<InMemoryQueue>()

    beforeAll(async () => {
      bus = await buildBus(
        new BatchResultReceiver(),
        checker.object,
        queue.object
      )
    })

    afterAll(async () => {
      await bus.dispose()
    })

    describe('and a batch with failing, returned, succeeding and unhandled messages is received', () => {
      const commands = [new TestCommand(), new TestCommand()]
      let result: BatchResult

      beforeAll(async () => {
        checker.reset()
        queue.reset()
        result = await bus.receive<BatchResult>([
          commands[0],
          new TestEvent(),
          new TestCommand2(),
          new TestCommand3(),
          commands[1]
        ])
      })

      it('should dispatch the other messages despite the failure', () => {
        checker.verify(
          c =>
            c.check(
              It.isObjectWith<Message>({ $name: TestCommand.NAME }),
              emptyAttributes
            ),
          Times.exactly(commands.length)
        )
      })

      it('should report only the failed and returned messages', () => {
        expect(result.failures.map(f => f.id)).toEqual(['1', '3'])
      })

      it('should report the returned message with a ReceivedMessageReturnedToQueue error', () => {
        expect(result.failures[1].error).toBeInstanceOf(
          ReceivedMessageReturnedToQueue
        )
      })

      it('should not delete messages, as the receiver host should handle it', () => {
        queue.verify(q => q.deleteMessage(It.isAny()), Times.never())
      })

      it('should return the failed and the returned messages to the transport', () => {
        queue.verify(
          q => q.returnMessage(It.isAny(), RETRY_DELAY),
          Times.exactly(2)
        )
      })
    })

    describe('and all messages in a batch succeed', () => {
      let result: BatchResult

      beforeAll(async () => {
        result = await bus.receive<BatchResult>([
          new TestCommand(),
          new TestCommand2()
        ])
      })

      it('should return the receiver result with no failures', () => {
        expect(result).toEqual({ failures: [] })
      })
    })
  })

  describe('when configuring Bus with a Receiver and a policy that dead-letters', () => {
    let bus: BusInstance
    const queue = Mock.ofType<InMemoryQueue>()

    beforeAll(async () => {
      bus = await buildBus(
        new BatchResultReceiver(),
        Mock.ofType<HandleChecker>().object,
        queue.object,
        () => deadLetter()
      )
    })

    afterAll(async () => {
      await bus.dispose()
    })

    describe('and a message fails', () => {
      let result: BatchResult

      beforeAll(async () => {
        queue.reset()
        result = await bus.receive<BatchResult>([new TestEvent()])
      })

      it('should move it to the dead letter queue with its failure metadata', () => {
        queue.verify(
          q =>
            q.fail(
              It.isAny(),
              It.is<MessageFailure>(
                failure =>
                  failure.failedAttempts === 1 && failure.error.name === 'Error'
              )
            ),
          Times.once()
        )
      })

      it('should not return it to the transport', () => {
        queue.verify(
          q => q.returnMessage(It.isAny(), It.isAny()),
          Times.never()
        )
      })

      it('should report it to the receiver host as handled, so the host deletes it', () => {
        expect(result).toEqual({ failures: [] })
      })
    })
  })

  describe('when configuring Bus with a Receiver and a handler fails the message and then throws', () => {
    let bus: BusInstance
    const queue = Mock.ofType<InMemoryQueue>()
    let result: BatchResult

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withReceiver(new BatchResultReceiver())
        .withHandler(
          handlerFor(TestCommand, async (_message, _attributes, ctx) => {
            await ctx.failMessage()
            throw new Error('Thrown after failing the message')
          })
        )
        .withTransport(queue.object)
        .withLogger(() => Mock.ofType<Logger>().object)
        .build()
      await bus.initialize()
      result = await bus.receive<BatchResult>([new TestCommand()])
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should move it to the dead letter queue without consulting the policy', () => {
      queue.verify(
        q =>
          q.fail(
            It.isAny(),
            It.is<MessageFailure>(
              failure =>
                failure.error.message === 'Thrown after failing the message'
            )
          ),
        Times.once()
      )
      queue.verify(q => q.returnMessage(It.isAny(), It.isAny()), Times.never())
    })

    it('should report it to the receiver host as handled', () => {
      expect(result).toEqual({ failures: [] })
    })
  })

  describe('when configuring Bus with a Receiver whose result hook throws', () => {
    let bus: BusInstance
    let result: Promise<unknown>

    beforeAll(async () => {
      bus = await buildBus(
        new ThrowingResultReceiver(),
        Mock.ofType<HandleChecker>().object,
        Mock.ofType<InMemoryQueue>().object
      )
      result = bus.receive([new TestCommand()])
      result.catch(() => undefined)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should reject with the error from the hook', async () => {
      await expect(result).rejects.toThrow('Batch rejected by receiver')
    })
  })
})
