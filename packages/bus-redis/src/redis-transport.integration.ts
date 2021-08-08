import { RedisTransport } from './redis-transport'
import {
  TestCommandHandler,
  TestPoisonedMessageHandler,
  TestPoisonedMessage,
  HandleChecker,
  TestFailMessageHandler,
  TestCommand,
  TestFailMessage
} from '../test'
import { Bus } from '@node-ts/bus-core'
import { RedisTransportConfiguration } from './redis-transport-configuration'
import * as faker from 'faker'
import { TestSystemMessageHandler } from '../test/test-system-message-handler'
import { Mock, IMock, It, Times } from 'typemoq'
import { Job } from 'bullmq'
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
  let sut: RedisTransport
  let handleChecker: IMock<HandleChecker>

  /**
   * removes all jobs irrespective of their state
   * 'completed' | 'wait' | 'active' | 'paused' | 'delayed' | 'failed'
   */
  async function purgeQueue() {
    return Promise.all(
      ['completed','wait','active','paused','delayed','failed']
        .map(jobState => sut['queue'].clean(2000, 100, jobState as any)))
  }

  beforeAll(async () => {
    handleChecker = Mock.ofType<HandleChecker>()

    sut = new RedisTransport(configuration)
    await Bus.configure()
      .withTransport(sut)
      .withContainer({
        get: type => new type(handleChecker.object)
      })
      .withHandler(TestPoisonedMessage, TestPoisonedMessageHandler)
      .withHandler(TestCommand, TestCommandHandler)
      .withHandler(
        TestSystemMessage,
        TestSystemMessageHandler,
        {
          resolveWith: (m: TestSystemMessage) => m.name === TestSystemMessage.NAME,
          topicIdentifier: TestSystemMessage.NAME
        }
      )
      .withHandler(TestFailMessage, TestFailMessageHandler)
      .initialize()

    await Bus.start()
  })

  afterAll(async () => {
    await Bus.dispose()
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
      await Bus.send(testCommand, messageOptions)
    })
    afterAll(async () => {
      await purgeQueue()
    })

    it('it should receive and dispatch to the handler', async () => {
      await sleep(2000)
      handleChecker.verify(
        h => h.check(It.isObjectWith({...testCommand}), It.isObjectWith(messageOptions)),
        Times.once()
      )
    })
    it(`it should not move the completed message to the completed queue`, async () => {
      const completedCount = await sut['queue'].getCompletedCount()
      expect(completedCount).toEqual(0)
    })
  })

  describe('when retrying a poisoned message', () => {
    const poisonedMessage = new TestPoisonedMessage(faker.random.uuid())
    let failedMessages: Job<any,any,string>[]
    beforeAll(async () => {
      await Bus.publish(poisonedMessage)
      await sleep(2000)
      failedMessages = await sut['queue'].getFailed()
    })
    afterAll(async () => {
      await purgeQueue()
    })

    it('it should attempt to process the message configuration.maxRetries times', () => {
      handleChecker.verify(
        h => h.check(It.is<TestPoisonedMessage>(m => m.id === poisonedMessage.id), It.isAny()),
        Times.exactly(configuration.maxRetries!)
      )
    })

    it('it should have been moved to the failed queue', () => {
      expect(failedMessages).toHaveLength(1)
      console.error(failedMessages[0])
      const deserialisedMessage = JSON.parse(failedMessages[0].data.message)
      expect(deserialisedMessage.id).toEqual(poisonedMessage.id)
    })
  })

  describe('when failing a message', () => {
    const failMessage = new TestFailMessage(faker.random.uuid())
    const correlationId = faker.random.uuid()
    let failedMessages: Job<any,any,string>[]
    let completedCount: number
    let delayedCount: number
    let activeCount: number
    let waitingCount: number

    beforeAll(async () => {
      await Bus.publish(failMessage, { correlationId })
      await sleep(2000)
      failedMessages = await sut['queue'].getFailed()
      completedCount = await sut['queue'].getCompletedCount()
      delayedCount = await sut['queue'].getDelayedCount()
      activeCount = await sut['queue'].getActiveCount()
      waitingCount = await sut['queue'].getWaitingCount()
    })
    afterAll(async () => {
      await purgeQueue()
    })

    it('it should be moved to the failed queue', () => {
      expect(failedMessages).toHaveLength(1)
    })
    it('there should be no other messages in the other queues', () => {
      expect(completedCount).toEqual(0)
      expect(delayedCount).toEqual(0)
      expect(activeCount).toEqual(0)
      expect(waitingCount).toEqual(0)
    })

    it('it should retain the same message attributes', () => {
      expect(failedMessages[0].data.correlationId).toEqual(correlationId)
    })
  })

  describe('when a system message is received', () => {
    const message = new TestSystemMessage()
    beforeAll(async () => {
      await sut['queue'].add(message.name, {message: JSON.stringify(message)})
    })

    afterAll(async () => {
      await purgeQueue()
    })

    it('it should handle the system message', async () => {
      await sleep(2000)
      handleChecker.verify(
        h => h.check(It.isObjectWith({...message}), It.isAny()),
        Times.once()
      )
    })
  })

})
