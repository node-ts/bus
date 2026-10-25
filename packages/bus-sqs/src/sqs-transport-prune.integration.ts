import {
  CreateTopicCommand,
  DeleteTopicCommand,
  ListSubscriptionsCommand,
  ListSubscriptionsResponse,
  SNSClient,
  SubscribeCommand,
  Subscription,
  UnsubscribeCommand
} from '@aws-sdk/client-sns'
import {
  DeleteQueueCommand,
  GetQueueUrlCommand,
  SQSClient
} from '@aws-sdk/client-sqs'
import {
  Bus,
  BusConfiguration,
  handlerFor,
  Logger,
  PruneOptions,
  PruneRefused,
  PruningPlan
} from '@node-ts/bus-core'
import {
  messageTypes,
  TestCommand,
  TestEvent,
  TestSystemMessage
} from '@node-ts/bus-test'
import { randomUUID } from 'node:crypto'
import { Mock } from 'typemoq'
import { SqsTransport } from './sqs-transport'
import { SqsTransportConfiguration } from './sqs-transport-configuration'

const AWS_REGION = process.env.AWS_REGION!
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID!
const LOCALSTACK_ENDPOINT =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566'

const resourcePrefix = `integration-bus-sqs-prune-${randomUUID().slice(0, 8)}`
const queueArn = (queueName: string) =>
  `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${queueName}`
const topicArn = (topicName: string) =>
  `arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:${topicName}`

const configuration = (queueName: string): SqsTransportConfiguration => ({
  awsRegion: AWS_REGION,
  awsAccountId: AWS_ACCOUNT_ID,
  queueName,
  deadLetterQueueName: `${resourcePrefix}-dead-letter`
})

const serviceQueue = `${resourcePrefix}-service`
const otherQueue = `${resourcePrefix}-other`
// Topics of custom handlers, which are managed outside the bus
const keptExternalTopic = `${resourcePrefix}-kept-external`
const removedExternalTopic = `${resourcePrefix}-removed-external`
// Topics the queue was subscribed to by hand, in ways the bus never subscribes
const rawTopic = `${resourcePrefix}-raw`
const filteredTopic = `${resourcePrefix}-filtered`
const handMadeTopics = [rawTopic, filteredTopic]

/**
 * The topic of a message, as the transport names it by default
 */
const messageTopicArn = (name: string) =>
  topicArn(name.replace(/[^a-zA-Z0-9_-]/g, '-'))

jest.setTimeout(30_000)

describe('SqsTransport pruning', () => {
  const sqs = new SQSClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION
  })
  const sns = new SNSClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION
  })

  const configure = (queueName: string): BusConfiguration =>
    Bus.configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withMessageTypes(messageTypes)
      .withTransport(new SqsTransport(configuration(queueName), sqs, sns))

  /**
   * The service as it was: it handled A (`TestCommand`), B (`TestEvent`) and two external topics
   */
  const configurePreviousVersion = () =>
    configure(serviceQueue)
      .withHandler(handlerFor(TestCommand, () => undefined))
      .withHandler(handlerFor(TestEvent, () => undefined))
      .withCustomHandler(async (_: TestSystemMessage) => undefined, {
        resolveWith: () => false,
        topicIdentifier: topicArn(keptExternalTopic)
      })
      .withCustomHandler(async (_: TestSystemMessage) => undefined, {
        resolveWith: () => false,
        topicIdentifier: topicArn(removedExternalTopic)
      })

  /**
   * The service now: it only handles A and one of the external topics
   */
  const configureCurrentVersion = () =>
    configure(serviceQueue)
      .withHandler(handlerFor(TestCommand, () => undefined))
      .withCustomHandler(async (_: TestSystemMessage) => undefined, {
        resolveWith: () => false,
        topicIdentifier: topicArn(keptExternalTopic)
      })

  const prune = async (
    busConfiguration: BusConfiguration,
    apply: boolean,
    options: PruneOptions = {}
  ): Promise<PruningPlan[]> => {
    const bus = busConfiguration.build()
    try {
      return await bus.prune({ ...options, apply })
    } finally {
      await bus.dispose()
    }
  }

  /**
   * Every subscription of the queues, reading every page of `ListSubscriptions`
   */
  const listSubscriptions = async (
    queueNames: string[]
  ): Promise<Subscription[]> => {
    const endpoints = queueNames.map(queueArn)
    const subscriptions: Subscription[] = []
    let nextToken: string | undefined = undefined
    do {
      const response: ListSubscriptionsResponse = await sns.send(
        new ListSubscriptionsCommand({ NextToken: nextToken })
      )
      subscriptions.push(...(response.Subscriptions ?? []))
      nextToken = response.NextToken
    } while (nextToken)
    return subscriptions.filter(({ Endpoint }) => endpoints.includes(Endpoint!))
  }

  /**
   * The topics a queue is subscribed to
   */
  const listSubscribedTopics = async (queueName: string): Promise<string[]> =>
    (await listSubscriptions([queueName]))
      .map(({ TopicArn }) => TopicArn!)
      .sort()

  beforeAll(async () => {
    for (const name of [
      keptExternalTopic,
      removedExternalTopic,
      ...handMadeTopics
    ]) {
      await sns.send(new CreateTopicCommand({ Name: name }))
    }
    for (const busConfiguration of [
      configurePreviousVersion(),
      configure(otherQueue).withHandler(handlerFor(TestEvent, () => undefined))
    ]) {
      const bus = busConfiguration.build()
      await bus.provision()
      await bus.dispose()
    }
    await sns.send(
      new SubscribeCommand({
        TopicArn: topicArn(rawTopic),
        Protocol: 'sqs',
        Endpoint: queueArn(serviceQueue),
        Attributes: { RawMessageDelivery: 'true' }
      })
    )
    await sns.send(
      new SubscribeCommand({
        TopicArn: topicArn(filteredTopic),
        Protocol: 'sqs',
        Endpoint: queueArn(serviceQueue),
        Attributes: {
          FilterPolicy: JSON.stringify({ 'attributes.region': ['eu'] })
        }
      })
    )
  })

  afterAll(async () => {
    for (const { SubscriptionArn } of await listSubscriptions([
      serviceQueue,
      otherQueue
    ])) {
      await sns.send(new UnsubscribeCommand({ SubscriptionArn }))
    }
    for (const queueName of [
      serviceQueue,
      otherQueue,
      `${resourcePrefix}-dead-letter`
    ]) {
      const { QueueUrl } = await sqs.send(
        new GetQueueUrlCommand({ QueueName: queueName })
      )
      await sqs.send(new DeleteQueueCommand({ QueueUrl }))
    }
    for (const name of [
      keptExternalTopic,
      removedExternalTopic,
      ...handMadeTopics
    ]) {
      await sns.send(new DeleteTopicCommand({ TopicArn: topicArn(name) }))
    }
  })

  describe('when the service no longer handles a message or an external topic', () => {
    let plans: PruningPlan[]
    let subscribedTopics: string[]

    beforeAll(async () => {
      plans = await prune(configureCurrentVersion(), false)
      subscribedTopics = await listSubscribedTopics(serviceQueue)
    })

    it("should list the queue's subscriptions to their topics", () => {
      expect(plans).toHaveLength(1)
      expect(plans[0].removed).toEqual([])
      expect(
        plans[0].resources.map(({ properties }) => properties?.topicArn).sort()
      ).toEqual(
        [messageTopicArn(TestEvent.NAME), topicArn(removedExternalTopic)].sort()
      )
    })

    it("should leave out the raw and filtered subscriptions the bus doesn't make", () => {
      const topicArns = plans[0].resources.map(
        ({ properties }) => properties?.topicArn
      )
      expect(topicArns).not.toContain(topicArn(rawTopic))
      expect(topicArns).not.toContain(topicArn(filteredTopic))
    })

    it('should not remove them', () => {
      expect(subscribedTopics).toContain(messageTopicArn(TestEvent.NAME))
      expect(subscribedTopics).toContain(topicArn(removedExternalTopic))
    })

    describe('and it is pruned with apply, approving only one of them', () => {
      let approvedPlans: PruningPlan[]

      beforeAll(async () => {
        const approved = plans[0].resources.find(
          ({ properties }) =>
            properties?.topicArn === topicArn(removedExternalTopic)
        )!
        approvedPlans = await prune(configureCurrentVersion(), true, {
          only: [approved]
        })
        subscribedTopics = await listSubscribedTopics(serviceQueue)
      })

      it('should only remove the approved one', () => {
        expect(
          approvedPlans[0].removed.map(({ properties }) => properties?.topicArn)
        ).toEqual([topicArn(removedExternalTopic)])
        expect(subscribedTopics).not.toContain(topicArn(removedExternalTopic))
        expect(subscribedTopics).toContain(messageTopicArn(TestEvent.NAME))
      })
    })

    describe('and it is pruned with apply', () => {
      let appliedPlans: PruningPlan[]
      let otherQueueTopics: string[]

      beforeAll(async () => {
        appliedPlans = await prune(configureCurrentVersion(), true)
        subscribedTopics = await listSubscribedTopics(serviceQueue)
        otherQueueTopics = await listSubscribedTopics(otherQueue)
      })

      it('should remove them', () => {
        expect(appliedPlans[0].removed).toEqual(appliedPlans[0].resources)
        expect(appliedPlans[0].removed).toHaveLength(1)
        expect(appliedPlans[0].failed).toEqual([])
        expect(subscribedTopics).not.toContain(messageTopicArn(TestEvent.NAME))
      })

      it("should keep the bus' own subscriptions, and the raw and filtered ones", () => {
        expect(subscribedTopics).toEqual(
          [
            messageTopicArn(TestCommand.NAME),
            topicArn(keptExternalTopic),
            topicArn(rawTopic),
            topicArn(filteredTopic)
          ].sort()
        )
      })

      it("should leave another queue's subscription to the same topic", () => {
        expect(otherQueueTopics).toEqual([messageTopicArn(TestEvent.NAME)])
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
    let subscribedTopics: string[]

    beforeAll(async () => {
      error = await prune(configure(serviceQueue), true).catch(
        (e: unknown) => e
      )
      subscribedTopics = await listSubscribedTopics(serviceQueue)
    })

    it('should refuse, leaving its subscriptions', () => {
      expect(error).toBeInstanceOf(PruneRefused)
      expect(error).toMatchObject({ reason: 'handles-nothing' })
      expect(subscribedTopics).toHaveLength(4)
    })
  })
})
