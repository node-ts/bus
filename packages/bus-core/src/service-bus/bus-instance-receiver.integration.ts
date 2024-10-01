import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { Receiver } from '../receiver'
import { MessageSerializer } from '../serialization'
import { InMemoryQueue, TransportMessage } from '../transport'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'
import { InvalidOperation } from './error'
import { handlerFor } from '../handler'
import { TestCommand, TestEvent } from '../test'
import { It, Mock, Times } from 'typemoq'

const emptyAttributes: MessageAttributes = {
  attributes: {},
  stickyAttributes: {}
}

class PassthroughReceiver
  implements Receiver<Message, TransportMessage<unknown>>
{
  async receive(
    receivedMessage: Message | Message[],
    _messageSerializer: MessageSerializer
  ): Promise<TransportMessage<unknown> | TransportMessage<unknown>[]> {
    const toSend = Array.isArray(receivedMessage)
      ? receivedMessage
      : [receivedMessage]
    return toSend.map(domainMessage => ({
      id: Date.now().toString(),
      attributes: emptyAttributes,
      domainMessage,
      raw: receivedMessage
    }))
  }
}

const receiver = new PassthroughReceiver()

describe('BusInstance Receiver', () => {
  describe('when configuring Bus with a Receiver', () => {
    let bus: BusInstance
    let commandHandler = jest.fn()
    let testCommandHandler = handlerFor(TestCommand, commandHandler)
    const handlerThatThrows = handlerFor(TestEvent, () => {
      throw new Error()
    })
    const queue = Mock.ofType<InMemoryQueue>()

    beforeAll(async () => {
      bus = Bus.configure()
        .withReceiver(receiver)
        .withHandler(testCommandHandler)
        .withHandler(handlerThatThrows)
        .withTransport(queue.object)
        .build()
      await bus.initialize()
    })

    afterAll(async () => {
      await bus.dispose()
    })

    describe('when bus.start() is called', () => {
      it('should throw an InvalidOperationError', async () => {
        await expect(bus.start()).rejects.toBeInstanceOf(InvalidOperation)
      })
    })

    describe('when a message is passed through to bus.receive()', () => {
      const command = new TestCommand()
      beforeAll(async () => {
        commandHandler.mockReset()
        await bus.receive(command)
      })

      it('should dispatch to handlers', () => {
        expect(commandHandler).toHaveBeenCalledWith(command, emptyAttributes)
      })

      it('should not call delete message, as the receiver implementation should handle it', () => {
        queue.verify(q => q.deleteMessage(It.isAny()), Times.never())
      })
    })

    describe('when an error is thrown when receiving a message', () => {
      it('the error should be re-thrown so the receiver host can retry the message', async () => {
        const event = new TestEvent()
        await expect(bus.receive(event)).rejects.toThrow()
        // Receiver host should return the message, not the application
        queue.verify(q => q.returnMessage(It.isAny()), Times.never())
      })
    })

    describe('when a batch of messages are passed through to bus.receive()', () => {
      const commands = Array(10)
        .fill(undefined)
        .map(() => new TestCommand())

      beforeAll(async () => {
        commandHandler.mockReset()
        await bus.receive(commands)
      })

      it('should dispatch all commands to handlers', () => {
        commands.forEach(command => {
          expect(commandHandler).toHaveBeenCalledWith(command, emptyAttributes)
        })
      })
    })
  })
})
