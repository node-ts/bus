import { MessageAttributes } from '@node-ts/bus-messages'
import EventEmitter from 'events'
import { randomUUID } from 'node:crypto'
import { IMock, It, Mock, Times } from 'typemoq'
import { TransportMessage } from '.'
import { sleep } from '../../dist'
import { DefaultHandlerRegistry, handlerFor, HandlerRegistry } from '../handler'
import { Logger, LoggerFactory } from '../logger'
import {
  FAILURE_HEADER,
  fromFailureHeader,
  MessageFailure
} from '../recoverability'
import { JsonSerializer, MessageSerializer } from '../serialization'
import { Bus } from '../service-bus/bus'
import {
  TestCommand,
  TestCommand2,
  TestEvent,
  TestEvent2,
  testMessageTypes
} from '../test'
import {
  EndpointNotFound,
  InMemoryQueueDisposed,
  TransportHeaderReserved
} from './error'
import { InMemoryMessage, InMemoryQueue } from './in-memory-queue'

const event = new TestEvent()
const command = new TestCommand()
const command2 = new TestCommand2()

describe('InMemoryQueue', () => {
  let sut: InMemoryQueue
  const messageOptions: MessageAttributes = {
    correlationId: randomUUID(),
    attributes: {},
    stickyAttributes: {}
  }

  const handlerRegistry: HandlerRegistry = new DefaultHandlerRegistry()
  let logger: IMock<Logger>
  let loggerFactory: LoggerFactory

  const serializer = new JsonSerializer()
  const messageTypes = { messages: {}, types: {} }
  const messageSerializer = new MessageSerializer(
    serializer,
    handlerRegistry,
    messageTypes
  )

  const buildCoreDependencies = (registry: HandlerRegistry) => ({
    handlerRegistry: registry,
    container: undefined,
    loggerFactory,
    messageSerializer,
    messageTypes,
    serializer,
    interruptSignals: []
  })

  beforeEach(async () => {
    logger = Mock.ofType<Logger>()
    loggerFactory = () => logger.object

    sut = new InMemoryQueue({ receiveTimeoutMs: 1000 })
    sut.prepare(buildCoreDependencies(handlerRegistry))

    handlerRegistry.register(TestEvent, () => undefined)
    handlerRegistry.register(TestCommand, () => undefined)
    handlerRegistry.register(TestEvent2, () => undefined)

    await sut.initialize()
  })

  describe('when reading the endpoint name', () => {
    describe('without one configured', () => {
      it('should default to in-memory', () => {
        expect(sut.endpointName).toEqual('in-memory')
      })
    })

    describe('with one configured', () => {
      let named: InMemoryQueue

      beforeEach(() => {
        named = new InMemoryQueue({
          receiveTimeoutMs: 1000,
          endpointName: 'order-service'
        })
      })

      it('should use it', () => {
        expect(named.endpointName).toEqual('order-service')
      })
    })
  })

  describe('when publishing an event', () => {
    it('should push the event onto the memory queue', async () => {
      await sut.publish(event, messageOptions)
      expect(sut.depth).toEqual(1)
    })
  })

  describe('when sending a command with headers', () => {
    let message: TransportMessage<InMemoryMessage> | undefined

    beforeEach(async () => {
      await sut.send(command, messageOptions, {
        headers: { 'x-delay': 5, priority: 'high', urgent: true }
      })
      message = await sut.readNextMessage()
    })

    it('should keep the headers on the raw message', () => {
      expect(message!.raw.headers).toEqual({
        'x-delay': 5,
        priority: 'high',
        urgent: true
      })
    })
  })

  describe('when publishing an event without headers', () => {
    let message: TransportMessage<InMemoryMessage> | undefined

    beforeEach(async () => {
      await sut.publish(event, messageOptions)
      message = await sut.readNextMessage()
    })

    it('should give the raw message no headers', () => {
      expect(message!.raw.headers).toEqual({})
    })
  })

  describe('when sending a command', () => {
    it('should push the command onto the memory queue', async () => {
      await sut.send(command, messageOptions)
      expect(sut.depth).toEqual(1)
    })
  })

  describe('when sending a message with a bus-failure header', () => {
    it('should throw TransportHeaderReserved', () => {
      expect(() =>
        sut.assertSendOptions({ headers: { [FAILURE_HEADER]: '{}' } })
      ).toThrow(TransportHeaderReserved)
    })
  })

  describe('when sending a message that is not handled', () => {
    beforeEach(async () => {
      await sut.send(command2, messageOptions)
    })

    it('should not push the message onto the queue', () => {
      expect(sut.depth).toEqual(0)
    })

    it('should log the discard at debug level rather than warn', () => {
      logger.verify(
        l =>
          l.debug(
            'Message was not sent as it has no registered handlers',
            It.isAny()
          ),
        Times.once()
      )
      logger.verify(l => l.warn(It.isAny(), It.isAny()), Times.never())
    })
  })

  describe('when sending a message to its own endpoint', () => {
    const replyOptions: MessageAttributes = {
      ...messageOptions,
      replyTo: 'another-endpoint'
    }
    let message: TransportMessage<InMemoryMessage> | undefined

    beforeEach(async () => {
      await sut.sendToAddress('in-memory', command2, replyOptions, {
        headers: { priority: 'high' }
      })
      message = await sut.readNextMessage()
    })

    it('should queue it even though it has no handler', () => {
      expect(message!.domainMessage).toEqual(command2)
    })

    it('should keep its attributes and headers', () => {
      expect(message!.attributes).toEqual(replyOptions)
      expect(message!.raw.headers).toEqual({ priority: 'high' })
    })
  })

  describe('when sending a message to another endpoint', () => {
    let sendError: unknown

    beforeEach(async () => {
      sendError = await sut
        .sendToAddress('another-endpoint', command, messageOptions)
        .catch((error: unknown) => error)
    })

    it('should throw EndpointNotFound', () => {
      expect(sendError).toBeInstanceOf(EndpointNotFound)
      expect(sendError).toMatchObject({
        address: 'another-endpoint',
        transportName: 'InMemoryQueue'
      })
    })

    it('should not queue it', () => {
      expect(sut.depth).toEqual(0)
    })
  })

  describe('when reading the next message', () => {
    it('should return undefined when the queue is empty', async () => {
      const message = await sut.readNextMessage()
      expect(message).toBeUndefined()
    })

    it('should return the message when the queue has one', async () => {
      await sut.publish(event, messageOptions)
      const message = await sut.readNextMessage()
      expect(message!.domainMessage).toEqual(event)
    })

    it('should read new messages with no failed attempts', async () => {
      await sut.publish(event, messageOptions)
      const message = await sut.readNextMessage()
      expect(message!.failedAttempts).toEqual(0)
    })

    it('should return the oldest message when there are many', async () => {
      await sut.publish(event, messageOptions)
      await sut.send(command)

      const firstMessage = await sut.readNextMessage()
      expect(firstMessage!.domainMessage).toEqual(event)

      const secondMessage = await sut.readNextMessage()
      expect(secondMessage!.domainMessage).toEqual(command)
    })

    it('should retain the queue depth while the message is unacknowledged', async () => {
      await sut.publish(event, messageOptions)
      expect(sut.depth).toEqual(1)

      const message = await sut.readNextMessage()
      expect(sut.depth).toEqual(1)

      await sut.deleteMessage(message!)
      expect(sut.depth).toEqual(0)
    })
  })

  describe('when returning a message back onto the queue', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    const retryDelay = 50
    beforeEach(async () => {
      await sut.publish(event, messageOptions)
      message = await sut.readNextMessage()
    })

    it('should toggle the inFlight flag to true when read', () => {
      expect(message).toBeDefined()
      expect(message!.raw.inFlight).toEqual(true)
    })

    it('should keep the message hidden until the delay has passed', async () => {
      await sut.returnMessage(message!, retryDelay)
      expect(message!.raw.inFlight).toEqual(true)
      await sleep(retryDelay * 2)
      expect(message!.raw.inFlight).toEqual(false)
    })

    it('should count the failed attempt on the next read', async () => {
      await sut.returnMessage(message!, 0)
      const retried = await sut.readNextMessage()
      expect(retried!.failedAttempts).toEqual(1)
    })

    it('should never move the message to the dead letter queue itself', async () => {
      let read = message
      for (let attempt = 0; attempt < 12; attempt++) {
        await sut.returnMessage(read!, 0)
        read = await sut.readNextMessage()
      }
      expect(sut.deadLetterQueueDepth).toEqual(0)
      expect(sut.depth).toEqual(1)
    })
  })

  describe('when failing a message', () => {
    const message = new TestEvent2()
    const failure: MessageFailure = {
      error: { name: 'Error', message: 'Failed' },
      failedAttempts: 1,
      endpoint: 'in-memory',
      messageId: undefined,
      failedAt: new Date().toISOString()
    }

    beforeEach(async () => {
      await sut.publish(message, messageOptions, {
        headers: { 'x-tenant': 'acme' }
      })
      const receivedMessage = await sut.readNextMessage()
      await sut.fail(receivedMessage!, failure)
    })

    it('should forward it to the dead letter queue', () => {
      expect(sut.deadLetterQueueDepth).toEqual(1)
    })

    it('should remove it from the queue', () => {
      expect(sut.depth).toEqual(0)
    })

    it('should add the failure metadata in the bus-failure header and keep the other headers', () => {
      const [deadLetter] = sut.deadLetterQueue
      expect(deadLetter.raw.headers['x-tenant']).toEqual('acme')
      expect(fromFailureHeader(deadLetter.raw.headers[FAILURE_HEADER])).toEqual(
        failure
      )
    })

    it('should only fail the handled message', async () => {
      const emitter = new EventEmitter()
      const queue = new InMemoryQueue({ receiveTimeoutMs: 100 })
      const bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(queue)
        .withConcurrency(1)
        .withHandler(
          handlerFor(TestEvent, async () => {
            await bus.failMessage()
          })
        )
        .withHandler(
          handlerFor(TestCommand, () => {
            emitter.emit('done')
          })
        )
        .build()

      await bus.initialize()
      await bus.start()

      const completion = new Promise<void>(resolve =>
        emitter.once('done', resolve)
      )
      await bus.publish(new TestEvent())
      await bus.send(new TestCommand())
      await completion
      await bus.stop()
      expect(queue.deadLetterQueue.map(m => m.domainMessage.$name)).toEqual([
        TestEvent.NAME
      ])
      await bus.dispose()
    })
  })

  describe('when a message is published while waiting for a read', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    let elapsedMs: number

    beforeEach(async () => {
      const startedAt = Date.now()
      const read = sut.readNextMessage()
      await sut.publish(event, messageOptions)
      message = await read
      elapsedMs = Date.now() - startedAt
    })

    it('should return the message without waiting for the receive timeout', () => {
      expect(message!.domainMessage).toEqual(event)
      expect(elapsedMs).toBeLessThan(500)
    })
  })

  describe('when many reads are waiting and one message is published', () => {
    let messages: (TransportMessage<InMemoryMessage> | undefined)[]

    beforeEach(async () => {
      const reads = [sut.readNextMessage(), sut.readNextMessage()]
      await sut.publish(event, messageOptions)
      messages = await Promise.all(reads)
    })

    it('should only return the message to one reader', () => {
      expect(messages.filter(m => !!m)).toHaveLength(1)
    })
  })

  describe('when a returned message becomes visible while waiting for a read', () => {
    let message: TransportMessage<InMemoryMessage> | undefined
    let elapsedMs: number

    beforeEach(async () => {
      await sut.publish(event, messageOptions)
      const firstRead = await sut.readNextMessage()
      await sut.returnMessage(firstRead!, 10)

      const startedAt = Date.now()
      message = await sut.readNextMessage()
      elapsedMs = Date.now() - startedAt
    })

    it('should return the message without waiting for the receive timeout', () => {
      expect(message!.domainMessage).toEqual(event)
      expect(elapsedMs).toBeLessThan(500)
    })
  })

  describe('when waiting for the queue to be idle', () => {
    describe('with nothing queued', () => {
      it('should resolve straight away', async () => {
        await expect(sut.idle()).resolves.toBeUndefined()
      })
    })

    describe('and the queue is disposed with a message left', () => {
      let idleError: unknown
      let idleAfterDisposeError: unknown

      beforeEach(async () => {
        await sut.publish(event, messageOptions)
        const idle = sut.idle().catch((e: unknown) => e)
        await sut.dispose()
        idleError = await idle
        idleAfterDisposeError = await sut.idle().catch((e: unknown) => e)
      })

      it('should reject with InMemoryQueueDisposed rather than never settling', () => {
        expect(idleError).toBeInstanceOf(InMemoryQueueDisposed)
        expect(idleError).toMatchObject({ queueDepth: 1 })
      })

      it('should reject when called after it was disposed', () => {
        expect(idleAfterDisposeError).toBeInstanceOf(InMemoryQueueDisposed)
      })
    })

    describe('with a message being handled', () => {
      let idleBeforeDelete: boolean
      let idleAfterDelete: boolean

      beforeEach(async () => {
        let isIdle = false
        await sut.publish(event, messageOptions)
        const message = await sut.readNextMessage()
        const idle = sut.idle().then(() => (isIdle = true))
        await sleep(10)
        idleBeforeDelete = isIdle
        await sut.deleteMessage(message!)
        await idle
        idleAfterDelete = isIdle
      })

      it('should resolve once the message is deleted', () => {
        expect(idleBeforeDelete).toEqual(false)
        expect(idleAfterDelete).toEqual(true)
      })
    })

    describe('with a message waiting to be retried', () => {
      let idleWhileWaiting: boolean
      let idleAfterFailing: boolean

      beforeEach(async () => {
        let isIdle = false
        await sut.publish(event, messageOptions)
        const message = await sut.readNextMessage()
        await sut.returnMessage(message!, 0)
        const idle = sut.idle().then(() => (isIdle = true))
        const retried = await sut.readNextMessage()
        idleWhileWaiting = isIdle
        await sut.fail(retried!, {
          error: { name: 'Error', message: 'Failed' },
          failedAttempts: 2,
          endpoint: sut.endpointName,
          messageId: undefined,
          failedAt: new Date().toISOString()
        })
        await idle
        idleAfterFailing = isIdle
      })

      it('should resolve once the message is dead-lettered', () => {
        expect(idleWhileWaiting).toEqual(false)
        expect(idleAfterFailing).toEqual(true)
      })
    })
  })

  describe('when disposing', () => {
    describe('with a read waiting', () => {
      let message: TransportMessage<InMemoryMessage> | undefined
      let elapsedMs: number

      beforeEach(async () => {
        const startedAt = Date.now()
        const read = sut.readNextMessage()
        await sut.dispose()
        message = await read
        elapsedMs = Date.now() - startedAt
      })

      it('should resolve the read with no message', () => {
        expect(message).toBeUndefined()
        expect(elapsedMs).toBeLessThan(500)
      })
    })

    describe('with a message waiting to be retried', () => {
      let message: TransportMessage<InMemoryMessage> | undefined
      const retryDelay = 20

      beforeEach(async () => {
        await sut.publish(event, messageOptions)
        message = await sut.readNextMessage()
        await sut.returnMessage(message!, retryDelay)
        await sut.dispose()
        await sleep(retryDelay * 2)
      })

      it('should cancel the retry', () => {
        expect(message!.raw.inFlight).toEqual(true)
      })
    })
  })

  describe('when sending before initialization', () => {
    let sendError: unknown

    beforeEach(async () => {
      sut = new InMemoryQueue()
      sut.prepare(buildCoreDependencies(handlerRegistry))
      try {
        await sut.send(command, messageOptions)
      } catch (error) {
        sendError = error
      }
    })

    it('should not throw', () => {
      expect(sendError).toBeUndefined()
    })

    it('should discard the message', () => {
      expect(sut.depth).toEqual(0)
    })
  })

  describe('when a send-only bus without handlers sends a message', () => {
    let sendError: unknown

    beforeEach(async () => {
      sut = new InMemoryQueue()
      const bus = Bus.configure()
        .withMessageTypes(testMessageTypes)
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .asSendOnly()
        .build()
      await bus.initialize()
      try {
        await bus.send(command2)
      } catch (error) {
        sendError = error
      }
      await bus.dispose()
    })

    it('should not throw', () => {
      expect(sendError).toBeUndefined()
    })

    it('should discard the message', () => {
      expect(sut.depth).toEqual(0)
    })
  })
})
