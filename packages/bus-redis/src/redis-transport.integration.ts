import { RedisMqTransport } from './redis-transport'
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
  maxRetries: 3,
  storeCompletedMessages: true
}

describe('RedisTransport', () => {
  let bus: Bus
  let sut: RedisMqTransport
  let container: TestContainer
  let bootstrap: ApplicationBootstrap
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
  const testCases: [string, boolean][] = [
    ['when sending a command with storeCompletedMessages enabled', true],
    ['when sending a command with storeCompletedMessages disabled', false]
  ]
  describe.each(testCases)('%s', (_, storeCompletedMessages: boolean) => {
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
      // Avoiding tearing down the container, favouring just changing the setting for the tests
      sut['storeCompletedMessages'] = storeCompletedMessages
      await bus.send(testCommand, messageOptions)
    })
    afterAll(async () => {
      await purgeQueue()
      // Restoring the setting afterwards
      sut['storeCompletedMessages'] = configuration.storeCompletedMessages as boolean
    })

    it('it should receive and dispatch to the handler', async () => {
      await sleep(1000 * 8)
      handleChecker.verify(
        h => h.check(It.isObjectWith({...testCommand}), It.isObjectWith(messageOptions)),
        Times.once()
      )
    })
    it('it should receive and dispatch to the handler', async () => {
      await sleep(1000 * 8)
      handleChecker.verify(
        h => h.check(It.isObjectWith({...testCommand}), It.isObjectWith(messageOptions)),
        Times.once()
      )
    })
    it(`it should${storeCompletedMessages ? '' :' not'} move the completed message to the completed queue`, async () => {
      const completedCount = await sut['queue'].getCompletedCount()
      expect(completedCount).toEqual(storeCompletedMessages ? 1 : 0)
    })
  })

  describe('when retrying a poisoned message', () => {
    const poisonedMessage = new TestPoisonedMessage(faker.random.uuid())
    let failedMessages: Job<any,any,string>[]
    beforeAll(async () => {
      await bus.publish(poisonedMessage)
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
      await bus.publish(failMessage, new MessageAttributes({ correlationId }))
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

    it('is should be moved to the failed queue', () => {
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
      await sleep(1000 * 8)
      handleChecker.verify(
        h => h.check(It.isObjectWith({...message}), It.isAny()),
        Times.once()
      )
    })
  })

})
