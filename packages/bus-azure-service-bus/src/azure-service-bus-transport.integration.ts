import { ServiceBusClient, ServiceBusReceivedMessage } from '@azure/service-bus'
import {
  Bus,
  BusInstance,
  EndpointNotFound,
  FAILURE_HEADER,
  fromFailureHeader,
  handlerFor,
  Logger,
  MessageFailure,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  TransportHeaderReserved
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import {
  DeadLetteredMessage,
  TestSystemMessage,
  transportTests
} from '@node-ts/bus-test'
import { EventEmitter, once } from 'node:events'
import { Mock } from 'typemoq'
import { AzureServiceBusTransport } from './azure-service-bus-transport'
import { AzureServiceBusMessageTooLarge } from './error'
import { toMessageAttributes } from './message-properties'
import {
  createEmulatorAdministrationClient,
  createEmulatorClient,
  deleteAllEntities,
  messageTypes,
  TestCommand
} from './test'

jest.setTimeout(60_000)

const resourcePrefix = 'bus-asb'
const systemMessageTopic = `${resourcePrefix}-test-system-message`

/**
 * Reads the messages on a queue, waiting up to 5 seconds for the first, then completes them
 */
const receiveAll = async (
  client: ServiceBusClient,
  queueName: string
): Promise<ServiceBusReceivedMessage[]> => {
  const receiver = client.createReceiver(queueName, {
    skipParsingBodyAsJson: true
  })
  try {
    const messages = await receiver.receiveMessages(10, {
      maxWaitTimeInMs: 5_000
    })
    await Promise.all(messages.map(async m => receiver.completeMessage(m)))
    return messages
  } finally {
    await receiver.close()
  }
}

const readBody = (message: ServiceBusReceivedMessage): Message =>
  JSON.parse((message.body as Buffer).toString('utf8')) as Message

describe('AzureServiceBusTransport', () => {
  const client = createEmulatorClient()
  const administrationClient = createEmulatorAdministrationClient()
  const deadLetterQueueName = `${resourcePrefix}-test-dead-letter`
  const transport = new AzureServiceBusTransport(
    { queueName: `${resourcePrefix}-test`, deadLetterQueueName },
    client,
    administrationClient
  )

  beforeAll(async () => {
    // Entities don't survive the emulator restarting, but they do survive an earlier run that failed part way
    await deleteAllEntities(administrationClient)
    await administrationClient.createTopic(systemMessageTopic)
  })

  afterAll(async () => {
    await deleteAllEntities(administrationClient)
    await client.close()
  })

  const publishSystemMessage = async (systemMessageAttribute: string) => {
    const sender = client.createSender(systemMessageTopic)
    await sender.sendMessages({
      body: Buffer.from(JSON.stringify(new TestSystemMessage())),
      contentType: 'application/json',
      applicationProperties: {
        'attributes.systemMessage': systemMessageAttribute
      }
    })
    await sender.close()
  }

  const readAllFromDeadLetterQueue = async (): Promise<
    DeadLetteredMessage[]
  > => {
    const messages = await receiveAll(client, deadLetterQueueName)
    return messages.map(message => ({
      message: readBody(message),
      attributes: toMessageAttributes(message),
      failure: fromFailureHeader(
        message.applicationProperties?.[FAILURE_HEADER] as string | undefined
      )
    }))
  }

  transportTests(
    transport,
    publishSystemMessage,
    systemMessageTopic,
    readAllFromDeadLetterQueue
  )

  describe('when a bus initializes before its resources are provisioned', () => {
    const queueName = `${resourcePrefix}-unprovisioned`
    let bus: BusInstance
    let error: unknown
    let queueCreated: boolean

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(
          new AzureServiceBusTransport(
            { queueName, deadLetterQueueName: `${queueName}-dead-letter` },
            client,
            administrationClient
          )
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      error = await bus.initialize().catch((e: unknown) => e)
      queueCreated = await administrationClient.queueExists(queueName)
    })

    afterAll(async () => bus.dispose())

    it('should fail with ResourcesNotProvisioned, naming the missing queue', () => {
      expect(error).toBeInstanceOf(ResourcesNotProvisioned)
      expect((error as ResourcesNotProvisioned).missingResources).toEqual([
        `Service Bus queue ${queueName}`
      ])
    })

    it('should not create the queue', () => {
      expect(queueCreated).toEqual(false)
    })
  })

  describe('when a bus that verifies subscriptions initializes without them', () => {
    const queueName = `${resourcePrefix}-unsubscribed`
    let bus: BusInstance
    let error: unknown

    beforeAll(async () => {
      await administrationClient.createQueue(queueName)
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(
          new AzureServiceBusTransport(
            {
              queueName,
              deadLetterQueueName: `${queueName}-dead-letter`,
              verifySubscriptions: true
            },
            client,
            administrationClient
          )
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      error = await bus.initialize().catch((e: unknown) => e)
    })

    afterAll(async () => {
      await bus.dispose()
      await administrationClient.deleteQueue(queueName)
    })

    it('should name the dead letter queue, topic and subscription that are missing', () => {
      expect(error).toBeInstanceOf(ResourcesNotProvisioned)
      expect((error as ResourcesNotProvisioned).missingResources).toEqual([
        `Service Bus queue ${queueName}-dead-letter`,
        'Service Bus topic node-ts-bus-azure-service-bus-test-command',
        `Service Bus subscription ${queueName} on topic node-ts-bus-azure-service-bus-test-command`
      ])
    })
  })

  describe('when a dry run is provisioned', () => {
    const queueName = `${resourcePrefix}-dry-run`
    let plans: ProvisioningPlan[]
    let queueCreated: boolean

    beforeAll(async () => {
      const bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(
          new AzureServiceBusTransport(
            { queueName, deadLetterQueueName: `${queueName}-dead-letter` },
            client,
            administrationClient
          )
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      plans = await bus.provision({ dryRun: true })
      await bus.dispose()
      queueCreated = await administrationClient.queueExists(queueName)
    })

    it('should plan the queue', () => {
      expect(plans[0].resources).toContainEqual(
        expect.objectContaining({
          type: 'azure-service-bus-queue',
          name: queueName
        })
      )
    })

    it('should plan the role assignments the service needs at runtime', () => {
      expect(plans[0].runtimePermissions?.format).toEqual('azure-rbac')
    })

    it('should not create it', () => {
      expect(queueCreated).toEqual(false)
    })
  })

  describe('when provisioning a subscription that exists and forwards elsewhere', () => {
    const queueName = `${resourcePrefix}-resync`
    const topicName = 'node-ts-bus-azure-service-bus-test-command'
    let forwardTo: string | undefined
    let forwardDeadLetteredMessagesTo: string | undefined

    beforeAll(async () => {
      await administrationClient.createTopic(topicName)
      await administrationClient.createSubscription(topicName, queueName)
      const bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(
          new AzureServiceBusTransport(
            { queueName, deadLetterQueueName: `${queueName}-dead-letter` },
            client,
            administrationClient
          )
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(handlerFor(TestCommand, () => undefined))
        .build()
      // Twice, to check provisioning what exists doesn't fail
      await bus.provision()
      await bus.provision()
      await bus.dispose()
      ;({ forwardTo, forwardDeadLetteredMessagesTo } =
        await administrationClient.getSubscription(topicName, queueName))
    })

    afterAll(async () => {
      await administrationClient.deleteTopic(topicName)
      await administrationClient.deleteQueue(queueName)
      await administrationClient.deleteQueue(`${queueName}-dead-letter`)
    })

    it('should make it forward to the service queue', () => {
      expect(forwardTo?.toLowerCase()).toMatch(new RegExp(`${queueName}$`))
    })

    it('should make it forward its dead letters to the dead letter queue', () => {
      expect(forwardDeadLetteredMessagesTo?.toLowerCase()).toMatch(
        new RegExp(`${queueName}-dead-letter$`)
      )
    })
  })

  describe('when outgoing middleware sets headers', () => {
    const queueName = `${resourcePrefix}-headers`
    const headersDeadLetterQueueName = `${queueName}-dead-letter`
    let bus: BusInstance
    let receivedProperties: Record<string, unknown> | undefined
    let deadLetterProperties: Record<string, unknown> | undefined
    let deadLetterFailure: MessageFailure | undefined
    let reservedHeaderError: unknown

    beforeAll(async () => {
      const handled = new EventEmitter()
      let sendReservedHeader = true
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(
          new AzureServiceBusTransport(
            { queueName, deadLetterQueueName: headersDeadLetterQueueName },
            client,
            administrationClient
          )
        )
        .withLogger(() => Mock.ofType<Logger>().object)
        .withAutoProvision()
        .withMiddleware({
          outgoing: async (context, next) => {
            if (sendReservedHeader) {
              context.headers.sentAt = 'from-a-header'
            } else {
              context.headers['x-tenant'] = 'acme'
              context.headers['x-priority'] = 3
            }
            await next()
          },
          incoming: async (context, next) => {
            const raw = context.transportMessage
              .raw as ServiceBusReceivedMessage
            receivedProperties = raw.applicationProperties
            await next()
            handled.emit('received')
          }
        })
        .withHandler(
          // Fails the message, to check its headers survive the dead letter queue
          handlerFor(TestCommand, async (_m, _a, ctx) => ctx.failMessage())
        )
        .build()
      await bus.initialize()
      await bus.start()

      reservedHeaderError = await bus
        .send(new TestCommand('reserved'))
        .catch((error: unknown) => error)
      sendReservedHeader = false

      const received = once(handled, 'received')
      await bus.send(new TestCommand('headers'))
      await received

      const [deadLetter] = await receiveAll(client, headersDeadLetterQueueName)
      deadLetterProperties = deadLetter?.applicationProperties
      deadLetterFailure = fromFailureHeader(
        deadLetterProperties?.[FAILURE_HEADER] as string | undefined
      )
    })

    afterAll(async () => {
      await bus.dispose()
      await administrationClient.deleteTopic(
        'node-ts-bus-azure-service-bus-test-command'
      )
      await administrationClient.deleteQueue(queueName)
      await administrationClient.deleteQueue(headersDeadLetterQueueName)
    })

    it('should send each header as an application property under its own name', () => {
      expect(receivedProperties).toMatchObject({
        'x-tenant': 'acme',
        'x-priority': 3
      })
    })

    it('should keep the headers when the message is forwarded to the dead letter queue', () => {
      expect(deadLetterProperties).toMatchObject({ 'x-tenant': 'acme' })
    })

    it('should keep the failure metadata when the message is forwarded to the dead letter queue', () => {
      expect(deadLetterFailure).toMatchObject({ endpoint: queueName })
    })

    it('should throw TransportHeaderReserved for a name the transport writes itself', () => {
      expect(reservedHeaderError).toBeInstanceOf(TransportHeaderReserved)
      expect(reservedHeaderError).toMatchObject({
        headerName: 'sentAt',
        transportName: 'AzureServiceBusTransport'
      })
    })
  })

  describe('when sending messages it can not deliver', () => {
    const queueName = `${resourcePrefix}-undeliverable`
    const sut = new AzureServiceBusTransport(
      { queueName, deadLetterQueueName: `${queueName}-dead-letter` },
      client,
      administrationClient
    )
    let bus: BusInstance
    let tooLargeError: unknown
    let missingQueueError: unknown
    let missingTopicError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .asSendOnly()
        .build()
      await bus.provision()
      await bus.initialize()
      tooLargeError = await bus
        .send(new TestCommand('x'.repeat(300 * 1024)))
        .catch((error: unknown) => error)
      const attributes: MessageAttributes = {
        attributes: {},
        stickyAttributes: {}
      }
      missingQueueError = await sut
        .sendToAddress(
          `${resourcePrefix}-no-such-queue`,
          new TestCommand('reply'),
          attributes
        )
        .catch((error: unknown) => error)
      missingTopicError = await sut
        .publish(new TestSystemMessage(), attributes)
        .catch((error: unknown) => error)
    })

    afterAll(async () => {
      await bus.dispose()
      await administrationClient.deleteTopic(
        'node-ts-bus-azure-service-bus-test-command'
      )
    })

    it('should throw AzureServiceBusMessageTooLarge for a message over the size limit', () => {
      expect(tooLargeError).toBeInstanceOf(AzureServiceBusMessageTooLarge)
      expect(tooLargeError).toMatchObject({
        messageName: TestCommand.NAME
      })
    })

    it('should throw EndpointNotFound for a reply to a queue that does not exist', () => {
      expect(missingQueueError).toBeInstanceOf(EndpointNotFound)
    })

    it('should throw ResourcesNotProvisioned for a message whose topic does not exist', () => {
      expect(missingTopicError).toBeInstanceOf(ResourcesNotProvisioned)
    })
  })
})
