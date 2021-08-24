import { RedisTransport } from './redis-transport'
import {
  TestContainer,
  TestCommandHandler,
  TestPoisonedMessageHandler,
  TestPoisonedMessage,
  HANDLE_CHECKER,
  HandleChecker,
  TestFailMessageHandler,
  TestCommand,
  TestFailMessage
} from '../test'
import { BUS_REDIS_SYMBOLS } from './bus-redis-symbols'
import { BUS_SYMBOLS, ApplicationBootstrap, Bus } from '@node-ts/bus-core'
import { RedisTransportConfiguration } from './redis-transport-configuration'
import * as faker from 'faker'
import { TestSystemMessageHandler } from '../test/test-system-message-handler'
import { Mock, IMock, It, Times } from 'typemoq'
import * as uuid from 'uuid'
import { MessageAttributes } from '@node-ts/bus-messages'
import { TestSystemMessage } from '../test/test-system-message'

jest.setTimeout(30000)

export async function sleep (timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}


const configuration: RedisTransportConfiguration = {
  queueName: 'node-ts/bus-redis-test',
  connectionString: 'redis://127.0.0.1:6379',
  maxRetries: 3
}

describe('RedisTransport', () => {
  let bus: Bus
  let sut: RedisTransport
  let container: TestContainer
  let bootstrap: ApplicationBootstrap
  let handleChecker: IMock<HandleChecker>

  beforeAll(async () => {
    handleChecker = Mock.ofType<HandleChecker>()
    container = new TestContainer()
    container.bind(HANDLE_CHECKER).toConstantValue(handleChecker.object)
    container.bind(BUS_REDIS_SYMBOLS.TransportConfiguration).toConstantValue(configuration)

    bus = container.get(BUS_SYMBOLS.Bus)
    sut = container.get(BUS_SYMBOLS.Transport)

    bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    bootstrap.registerHandler(TestPoisonedMessageHandler)
    bootstrap.registerHandler(TestCommandHandler)
    bootstrap.registerHandler(TestSystemMessageHandler)

    bootstrap.registerHandler(TestFailMessageHandler)

    await bootstrap.initialize(container)
  })

  afterAll(async () => {
    await bootstrap.dispose()
  })

  describe('when sending a command', () => {
    const testCommand = new TestCommand(uuid.v4(), new Date())
    const messageOptions: MessageAttributes = {
      correlationId: faker.random.uuid(),
      attributes: {
        attribute1: 'a',
        attribute2: 1
      },
      stickyAttributes: {
        attribute1: 'b',
        attribute2: 2
      }
    }

    beforeAll(async () => {
      await bus.send(testCommand, messageOptions)
    })
    afterAll(async () => {
      await sut['queue'].destroyQueue()
    })

    it('it should receive and dispatch to the handler', async () => {
      await sleep(2000)
      handleChecker.verify(
        h => h.check(It.isObjectWith({...testCommand}), It.isObjectWith(messageOptions)),
        Times.once()
      )
    })
    it(`it should not move the completed message to the completed queue`, async () => {
      const completedCount = await sut['queue'].queueStats()
      expect(completedCount).toEqual({dlq: 0, inflight: 0, queue:0})
    })
  })

  describe('when retrying a poisoned message', () => {
    const poisonedMessage = new TestPoisonedMessage(faker.random.uuid())
    beforeAll(async () => {
      await bus.publish(poisonedMessage)
      await sleep(2000)
    })
    afterAll(async () => {
      await sut['queue'].destroyQueue()
    })

    it('it should attempt to process the message configuration.maxRetries times', () => {
      handleChecker.verify(
        h => h.check(It.is<TestPoisonedMessage>(m => m.id === poisonedMessage.id), It.isAny()),
        Times.exactly(configuration.maxRetries!)
      )
    })

    it('it should have been moved to the dead letter queue', async () => {
      const queueStats = await sut['queue'].queueStats()
      expect(queueStats).toEqual({dlq: 1, inflight: 0, queue:0})
    })
  })

  describe('when failing a message', () => {
    const failMessage = new TestFailMessage(faker.random.uuid())
    const correlationId = faker.random.uuid()
    let queueStats: {
      queue: number
      dlq: number
      inflight: number
    }

    beforeAll(async () => {
      await bus.publish(failMessage, new MessageAttributes({ correlationId }))
      await sleep(2000)
      queueStats = await sut['queue'].queueStats()
    })
    afterAll(async () => {
      await sut['queue'].destroyQueue()
    })

    it('it should be moved to the dead letter queue', () => {
      expect(queueStats).toEqual({dlq: 1, inflight: 0, queue:0})
    })
  })

  describe('when a system message is received', () => {
    const testMessage = new TestSystemMessage()
    const serializedMessage = JSON.stringify(testMessage)
    const message = { message : serializedMessage }
    beforeAll(async () => {
      await sut['queue'].publish(JSON.stringify(message))
    })

    afterAll(async () => {
      await sut['queue'].destroyQueue()
    })

    it('it should handle the system message', async () => {
      await sleep(2000)
      handleChecker.verify(
        h => h.check(It.isObjectWith({...testMessage}), It.isAny()),
        Times.once()
      )
    })
  })

})
