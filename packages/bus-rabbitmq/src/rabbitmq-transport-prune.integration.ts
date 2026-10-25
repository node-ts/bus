import {
  Bus,
  BusConfiguration,
  handlerFor,
  Logger,
  PruneRefused,
  PruningPlan
} from '@node-ts/bus-core'
import {
  messageTypes,
  TestCommand,
  TestEvent,
  TestSystemMessage
} from '@node-ts/bus-test'
import { ChannelModel, connect } from 'amqplib'
import { randomUUID } from 'node:crypto'
import { Mock } from 'typemoq'
import { RabbitMqManagementUrlMissing } from './error'
import { RabbitMqTransport } from './rabbitmq-transport'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import { getQueueBindings, getQueues } from './test'

const CONNECTION_STRING =
  process.env.RABBITMQ_URL || 'amqp://guest:guest@0.0.0.0'
const MANAGEMENT_URL =
  process.env.RABBITMQ_MANAGEMENT_URL || 'http://127.0.0.1:15672'

const prefix = `@node-ts/bus-rabbitmq-prune-${randomUUID().slice(0, 8)}`
const serviceQueue = `${prefix}-service`
const otherQueue = `${prefix}-other`
// Exchanges of custom handlers, which are managed outside the bus
const keptExternalExchange = `${prefix}-kept-external`
const removedExternalExchange = `${prefix}-removed-external`
// Bound to the service queue by something other than the bus, in ways the bus never binds
const topicExchange = `${prefix}-topic`
const keyedFanoutExchange = `${prefix}-keyed-fanout`

const configuration = (
  queueName: string,
  overrides: Partial<RabbitMqTransportConfiguration> = {}
): RabbitMqTransportConfiguration => ({
  queueName,
  deadLetterQueueName: `${prefix}-dead-letter`,
  connectionString: CONNECTION_STRING,
  managementUrl: MANAGEMENT_URL,
  ...overrides
})

jest.setTimeout(30_000)

describe('RabbitMqTransport pruning', () => {
  let connection: ChannelModel

  const configure = (
    queueName: string,
    overrides: Partial<RabbitMqTransportConfiguration> = {}
  ): BusConfiguration =>
    Bus.configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withMessageTypes(messageTypes)
      .withTransport(new RabbitMqTransport(configuration(queueName, overrides)))

  /**
   * The service as it was: it handled A (`TestCommand`), B (`TestEvent`) and two external exchanges
   */
  const configurePreviousVersion = () =>
    configure(serviceQueue)
      .withHandler(handlerFor(TestCommand, () => undefined))
      .withHandler(handlerFor(TestEvent, () => undefined))
      .withCustomHandler(async (_: TestSystemMessage) => undefined, {
        resolveWith: () => false,
        topicIdentifier: keptExternalExchange
      })
      .withCustomHandler(async (_: TestSystemMessage) => undefined, {
        resolveWith: () => false,
        topicIdentifier: removedExternalExchange
      })

  /**
   * The service now: it only handles A and one of the external exchanges
   */
  const configureCurrentVersion = (
    overrides: Partial<RabbitMqTransportConfiguration> = {}
  ) =>
    configure(serviceQueue, overrides)
      .withHandler(handlerFor(TestCommand, () => undefined))
      .withCustomHandler(async (_: TestSystemMessage) => undefined, {
        resolveWith: () => false,
        topicIdentifier: keptExternalExchange
      })

  const prune = async (
    busConfiguration: BusConfiguration,
    apply: boolean
  ): Promise<PruningPlan[]> => {
    const bus = busConfiguration.build()
    try {
      return await bus.prune({ apply })
    } finally {
      await bus.dispose()
    }
  }

  /**
   * The exchanges a queue is bound to, other than the default exchange
   */
  const listBoundExchanges = async (queueName: string): Promise<string[]> =>
    (await getQueueBindings(queueName))
      .map(({ source }) => source)
      .filter(source => source !== '')
      .sort()

  beforeAll(async () => {
    connection = await connect(CONNECTION_STRING)
    const channel = await connection.createChannel()
    for (const busConfiguration of [
      configurePreviousVersion(),
      configure(otherQueue).withHandler(handlerFor(TestEvent, () => undefined))
    ]) {
      const bus = busConfiguration.build()
      await bus.provision()
      await bus.dispose()
    }
    await channel.assertExchange(topicExchange, 'topic', { durable: false })
    await channel.bindQueue(serviceQueue, topicExchange, '')
    await channel.assertExchange(keyedFanoutExchange, 'fanout', {
      durable: false
    })
    await channel.bindQueue(serviceQueue, keyedFanoutExchange, 'orders')
    await channel.close()
  })

  afterAll(async () => {
    const channel = await connection.createChannel()
    for (const { name } of await getQueues(prefix)) {
      await channel.deleteQueue(name)
    }
    for (const exchange of [
      keptExternalExchange,
      removedExternalExchange,
      topicExchange,
      keyedFanoutExchange,
      serviceQueue,
      otherQueue,
      `${serviceQueue}-retry`,
      `${otherQueue}-retry`
    ]) {
      await channel.deleteExchange(exchange)
    }
    await channel.close()
    await connection.close()
  })

  describe('when the service no longer handles a message or an external exchange', () => {
    let plans: PruningPlan[]
    let boundExchanges: string[]

    beforeAll(async () => {
      plans = await prune(configureCurrentVersion(), false)
      boundExchanges = await listBoundExchanges(serviceQueue)
    })

    it("should list the queue's bindings to their exchanges", () => {
      expect(plans).toHaveLength(1)
      expect(plans[0].removed).toEqual([])
      expect(plans[0].resources).toEqual(
        expect.arrayContaining([
          {
            type: 'rabbitmq-binding',
            name: `${TestEvent.NAME} -> ${serviceQueue}`,
            properties: {
              exchange: TestEvent.NAME,
              queue: serviceQueue,
              routingKey: ''
            }
          },
          expect.objectContaining({
            name: `${removedExternalExchange} -> ${serviceQueue}`
          })
        ])
      )
      expect(plans[0].resources).toHaveLength(2)
    })

    it('should not remove them', () => {
      expect(boundExchanges).toContain(TestEvent.NAME)
      expect(boundExchanges).toContain(removedExternalExchange)
    })

    describe('and it is pruned with apply', () => {
      let appliedPlans: PruningPlan[]
      let otherQueueExchanges: string[]

      beforeAll(async () => {
        appliedPlans = await prune(configureCurrentVersion(), true)
        boundExchanges = await listBoundExchanges(serviceQueue)
        otherQueueExchanges = await listBoundExchanges(otherQueue)
      })

      it('should unbind them', () => {
        expect(appliedPlans[0].removed).toEqual(appliedPlans[0].resources)
        expect(appliedPlans[0].removed).toHaveLength(2)
        expect(appliedPlans[0].failed).toEqual([])
        expect(boundExchanges).not.toContain(TestEvent.NAME)
        expect(boundExchanges).not.toContain(removedExternalExchange)
      })

      it("should keep the bus' own bindings, and those it doesn't make", () => {
        expect(boundExchanges).toEqual(
          [
            serviceQueue,
            TestCommand.NAME,
            keptExternalExchange,
            topicExchange,
            keyedFanoutExchange
          ].sort()
        )
      })

      it("should leave another queue's binding to the same exchange", () => {
        expect(otherQueueExchanges).toContain(TestEvent.NAME)
      })

      describe('and pruned again', () => {
        let againPlans: PruningPlan[]

        beforeAll(async () => {
          againPlans = await prune(configureCurrentVersion(), false)
        })

        it('should find nothing to prune', () => {
          expect(againPlans[0].resources).toEqual([])
        })
      })
    })
  })

  describe('when the transport has no management url', () => {
    let error: unknown

    beforeAll(async () => {
      error = await prune(
        configureCurrentVersion({ managementUrl: undefined }),
        false
      ).catch((e: unknown) => e)
    })

    it('should fail, saying how to configure it', () => {
      expect(error).toBeInstanceOf(RabbitMqManagementUrlMissing)
    })
  })

  describe('when a send-only bus is pruned', () => {
    let error: unknown

    beforeAll(async () => {
      error = await prune(configure(serviceQueue).asSendOnly(), true).catch(
        (e: unknown) => e
      )
    })

    it('should refuse', () => {
      expect(error).toBeInstanceOf(PruneRefused)
      expect(error).toMatchObject({ reason: 'send-only' })
    })
  })

  describe('when a bus that handles nothing is pruned', () => {
    let error: unknown
    let boundExchanges: string[]

    beforeAll(async () => {
      error = await prune(configure(serviceQueue), true).catch(
        (e: unknown) => e
      )
      boundExchanges = await listBoundExchanges(serviceQueue)
    })

    it('should refuse, leaving its bindings', () => {
      expect(error).toBeInstanceOf(PruneRefused)
      expect(error).toMatchObject({ reason: 'handles-nothing' })
      expect(boundExchanges).toContain(TestCommand.NAME)
    })
  })
})
