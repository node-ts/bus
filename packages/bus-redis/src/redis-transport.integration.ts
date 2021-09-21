import { RedisTransport } from './redis-transport'
import { MessageSerializer } from '@node-ts/bus-core'
import { RedisTransportConfiguration } from './redis-transport-configuration'
<<<<<<< HEAD
import { TestSystemMessage, transportTests } from '@node-ts/bus-test'
=======
import * as faker from 'faker'
import { TestSystemMessageHandler } from '../test/test-system-message-handler'
import { Mock, IMock, It, Times } from 'typemoq'
import * as uuid from 'uuid'
import { MessageAttributes } from '@node-ts/bus-messages'
import { TestSystemMessage } from '../test/test-system-message'
import { QueueStats } from 'modest-queue'

jest.setTimeout(30000)

export async function sleep (timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}

>>>>>>> master

const configuration: RedisTransportConfiguration = {
  queueName: 'node-ts/bus-redis-test',
  connectionString: 'redis://127.0.0.1:6379',
  maxRetries: 3
}

describe('RedisTransport', () => {
  jest.setTimeout(30000)

  const redisTransport = new RedisTransport(configuration)

<<<<<<< HEAD
  /**
   * removes all jobs irrespective of their state
   * 'completed' | 'wait' | 'active' | 'paused' | 'delayed' | 'failed'
   */
  async function purgeQueue() {
    return Promise.all(
      ['completed','wait','active','paused','delayed','failed']
        .map(jobState => redisTransport['queue'].clean(2000, 100, jobState as any)))
  }

  const systemMessageTopicIdentifier = TestSystemMessage.NAME
  const message = new TestSystemMessage()
  const publishSystemMessage = async (systemMessageAttribute: string) => {
    const attributes = { systemMessage: systemMessageAttribute }
=======
  beforeAll(async () => {
    handleChecker = Mock.ofType<HandleChecker>()
    container = new TestContainer()
    container.bind(HANDLE_CHECKER).toConstantValue(handleChecker.object)
    container.bind(BUS_REDIS_SYMBOLS.TransportConfiguration).toConstantValue(configuration)

    bus = container.get(BUS_SYMBOLS.Bus)
    sut = container.get(BUS_SYMBOLS.Transport)
>>>>>>> master

    const payload = {
      message: MessageSerializer.serialize(message as any),
      correlationId: undefined,
      attributes: attributes,
      stickyAttributes: {}
    }

<<<<<<< HEAD
    redisTransport['queue'].add(systemMessageTopicIdentifier, payload)
  }

  const readAllFromDeadLetterQueue = async () => {
    return []
  }

  beforeAll(async () => {
    await purgeQueue()
  })

  transportTests(
    redisTransport,
    publishSystemMessage,
    systemMessageTopicIdentifier,
    readAllFromDeadLetterQueue
  )
=======
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
    it(`The queue stats should be empty as all messages have been completed`, async () => {
      const completedCount = await sut['queue'].queueStats()
      expect(completedCount).toEqual({dlq: 0, inflight: 0, queue:0, delayed: 0})
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
      expect(queueStats).toEqual({dlq: 1, inflight: 0, queue:0, delayed: 0})
    })
  })

  describe('when failing a message', () => {
    const failMessage = new TestFailMessage(faker.random.uuid())
    const correlationId = faker.random.uuid()
    let queueStats: QueueStats

    beforeAll(async () => {
      await bus.publish(failMessage, new MessageAttributes({ correlationId }))
      await sleep(2000)
      queueStats = await sut['queue'].queueStats()
    })
    afterAll(async () => {
      await sut['queue'].destroyQueue()
    })

    it('it should be moved to the dead letter queue', () => {
      expect(queueStats).toEqual({dlq: 1, inflight: 0, queue:0, delayed: 0})
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
>>>>>>> master

})
