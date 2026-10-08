import {
  ServiceBusAdministrationClient,
  ServiceBusClient,
  ServiceBusError,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusSender
} from '@azure/service-bus'
import {
  CoreDependencies,
  DefaultHandlerRegistry,
  FAILURE_HEADER,
  fromFailureHeader,
  JsonSerializer,
  Logger,
  MessageFailure,
  MessageSerializer,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  TransportMessage,
  TransportProvisionOptions
} from '@node-ts/bus-core'
import { Event } from '@node-ts/bus-messages'
import { IMock, It, Mock, Times } from 'typemoq'
import { AzureServiceBusTransport } from './azure-service-bus-transport'
import { AzureServiceBusTransportConfiguration } from './azure-service-bus-transport-configuration'
import {
  AzureServiceBusConnectionNotConfigured,
  AzureServiceBusMessageTooLarge,
  AzureServiceBusTierNotSupported
} from './error'

class TestEvent extends Event {
  static NAME = '@node-ts/bus-azure-service-bus/test-event'
  $name = TestEvent.NAME
  $version = 0
}

const configuration: AzureServiceBusTransportConfiguration = {
  queueName: 'orders',
  deadLetterQueueName: 'orders-dead-letter'
}

/**
 * The handler registry of a bus that handles `TestEvent`, and a custom handler's topic
 */
const handlerRegistry = {
  getMessageNames: () => [TestEvent.NAME],
  getExternallyManagedTopicIdentifiers: () => ['system-topic']
} as unknown as TransportProvisionOptions['handlerRegistry']

const provisionOptions = (
  options: Partial<TransportProvisionOptions> = {}
): TransportProvisionOptions => ({
  handlerRegistry,
  sendOnly: false,
  messageNames: ['@node-ts/bus-azure-service-bus/sent-command'],
  sendsAnyMessage: false,
  dryRun: false,
  ...options
})

const prepare = (sut: AzureServiceBusTransport) =>
  sut.prepare({
    loggerFactory: () => Mock.ofType<Logger>().object,
    messageSerializer: new MessageSerializer(
      new JsonSerializer(),
      new DefaultHandlerRegistry(),
      { messages: {}, types: {} }
    )
  } as unknown as CoreDependencies)

const serviceBusError = (code: ServiceBusError['code']) =>
  new ServiceBusError('rejected', code)

const alreadyExists = () =>
  Object.assign(new Error('Conflict'), {
    statusCode: 409,
    code: 'MessageEntityAlreadyExistsError'
  })

const receivedMessage = (
  properties: Partial<ServiceBusReceivedMessage> = {}
): ServiceBusReceivedMessage =>
  ({
    body: Buffer.from(JSON.stringify(new TestEvent())),
    messageId: 'message-1',
    subject: TestEvent.NAME,
    contentType: 'application/json',
    correlationId: 'correlation-1',
    replyTo: 'orders',
    applicationProperties: { messageId: 'message-1', 'attributes.a': 1 },
    ...properties
  }) as ServiceBusReceivedMessage

/**
 * A started transport over mocked clients
 */
const startedTransport = async () => {
  const client = Mock.ofType<ServiceBusClient>()
  const receiver = Mock.ofType<ServiceBusReceiver>()
  const sender = Mock.ofType<ServiceBusSender>()
  client
    .setup(c => c.createReceiver(It.isAny(), It.isAny()))
    .returns(() => receiver.object)
  client.setup(c => c.createSender(It.isAny())).returns(() => sender.object)
  receiver
    .setup(r => r.subscribe(It.isAny(), It.isAny()))
    .returns(() => ({ close: async () => undefined }))
  const sut = new AzureServiceBusTransport(configuration, client.object)
  prepare(sut)
  await sut.connect({ concurrency: 1 })
  await sut.start()
  return { sut, client, receiver, sender }
}

const toTransportMessage = (
  raw: ServiceBusReceivedMessage,
  failedAttempts = 0
): TransportMessage<ServiceBusReceivedMessage> => ({
  id: raw.messageId?.toString(),
  raw,
  domainMessage: new TestEvent(),
  attributes: { attributes: {}, stickyAttributes: {} },
  failedAttempts
})

describe('AzureServiceBusTransport', () => {
  describe('when connecting without a connection string, credential or client', () => {
    let error: unknown

    beforeAll(async () => {
      const sut = new AzureServiceBusTransport(configuration)
      prepare(sut)
      error = await sut.connect({ concurrency: 1 }).catch(e => e)
    })

    it('should throw AzureServiceBusConnectionNotConfigured', () => {
      expect(error).toBeInstanceOf(AzureServiceBusConnectionNotConfigured)
    })
  })

  describe('when a dry run is provisioned', () => {
    const administrationClient = Mock.ofType<ServiceBusAdministrationClient>()
    let plan: ProvisioningPlan

    beforeAll(async () => {
      const sut = new AzureServiceBusTransport(
        configuration,
        undefined,
        administrationClient.object
      )
      prepare(sut)
      plan = await sut.provision(provisionOptions({ dryRun: true }))
    })

    it('should make no calls', () => {
      administrationClient.verify(
        a => a.getNamespaceProperties(),
        Times.never()
      )
      administrationClient.verify(
        a => a.createTopic(It.isAny(), It.isAny()),
        Times.never()
      )
      administrationClient.verify(
        a => a.createQueue(It.isAny(), It.isAny()),
        Times.never()
      )
    })

    it('should plan a topic for each message it sends and handles, but not for external topics', () => {
      expect(
        plan.resources
          .filter(({ type }) => type === 'azure-service-bus-topic')
          .map(({ name }) => name)
      ).toEqual([
        'node-ts-bus-azure-service-bus-sent-command',
        'node-ts-bus-azure-service-bus-test-event'
      ])
    })

    it('should plan the dead letter queue before the service queue that forwards to it', () => {
      expect(
        plan.resources.filter(({ type }) => type === 'azure-service-bus-queue')
      ).toEqual([
        {
          type: 'azure-service-bus-queue',
          name: 'orders-dead-letter',
          properties: {}
        },
        {
          type: 'azure-service-bus-queue',
          name: 'orders',
          properties: {
            lockDuration: 'PT1M',
            maxDeliveryCount: 10,
            forwardDeadLetteredMessagesTo: 'orders-dead-letter'
          }
        }
      ])
    })

    it('should plan a forwarding subscription on each handled and external topic', () => {
      expect(
        plan.resources.filter(
          ({ type }) => type === 'azure-service-bus-subscription'
        )
      ).toEqual([
        {
          type: 'azure-service-bus-subscription',
          name: 'node-ts-bus-azure-service-bus-test-event/subscriptions/orders',
          properties: {
            topicName: 'node-ts-bus-azure-service-bus-test-event',
            subscriptionName: 'orders',
            forwardTo: 'orders',
            forwardDeadLetteredMessagesTo: 'orders-dead-letter'
          }
        },
        {
          type: 'azure-service-bus-subscription',
          name: 'system-topic/subscriptions/orders',
          properties: {
            topicName: 'system-topic',
            subscriptionName: 'orders',
            forwardTo: 'orders',
            forwardDeadLetteredMessagesTo: 'orders-dead-letter',
            externalTopic: true
          }
        }
      ])
    })

    it('should plan the roles to receive from and send to the queue, and send to its topics', () => {
      expect(plan.runtimePermissions).toEqual({
        format: 'azure-rbac',
        document: {
          roleAssignments: [
            {
              role: 'Azure Service Bus Data Receiver',
              roleDefinitionId: '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0',
              scope: '/queues/orders'
            },
            {
              role: 'Azure Service Bus Data Sender',
              roleDefinitionId: '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39',
              scope: '/queues/orders'
            },
            {
              role: 'Azure Service Bus Data Sender',
              roleDefinitionId: '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39',
              scope: '/topics/node-ts-bus-azure-service-bus-sent-command'
            },
            {
              role: 'Azure Service Bus Data Sender',
              roleDefinitionId: '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39',
              scope: '/topics/node-ts-bus-azure-service-bus-test-event'
            }
          ]
        }
      })
    })
  })

  describe('when a scheduler that sends any message is provisioned', () => {
    let plan: ProvisioningPlan

    beforeAll(async () => {
      const sut = new AzureServiceBusTransport(configuration)
      prepare(sut)
      plan = await sut.provision(
        provisionOptions({
          dryRun: true,
          sendOnly: true,
          sendsAnyMessage: true
        })
      )
    })

    it('should plan the role to send to the whole namespace, and none to receive', () => {
      expect(plan.runtimePermissions?.document).toEqual({
        roleAssignments: [
          {
            role: 'Azure Service Bus Data Sender',
            roleDefinitionId: '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39',
            scope: ''
          }
        ]
      })
    })
  })

  describe('when provisioning a namespace on the Basic tier', () => {
    const administrationClient = Mock.ofType<ServiceBusAdministrationClient>()
    let error: unknown

    beforeAll(async () => {
      administrationClient
        .setup(a => a.getNamespaceProperties())
        .returns(async () => ({ name: 'ns', messagingSku: 'Basic' }) as any)
      const sut = new AzureServiceBusTransport(
        configuration,
        undefined,
        administrationClient.object
      )
      prepare(sut)
      error = await sut.provision(provisionOptions()).catch(e => e)
    })

    it('should throw AzureServiceBusTierNotSupported', () => {
      expect(error).toBeInstanceOf(AzureServiceBusTierNotSupported)
      expect(error).toMatchObject({ namespace: 'ns', tier: 'Basic' })
    })

    it('should create nothing', () => {
      administrationClient.verify(
        a => a.createTopic(It.isAny(), It.isAny()),
        Times.never()
      )
    })
  })

  describe('when provisioning entities that exist', () => {
    const administrationClient = Mock.ofType<ServiceBusAdministrationClient>()

    beforeAll(async () => {
      administrationClient
        .setup(a => a.getNamespaceProperties())
        .returns(async () => ({ name: 'ns', messagingSku: 'Standard' }) as any)
      administrationClient
        .setup(a => a.createTopic(It.isAny(), It.isAny()))
        .returns(async () => Promise.reject(alreadyExists()))
      administrationClient
        .setup(a => a.createQueue(It.isAny(), It.isAny()))
        .returns(async () => Promise.reject(alreadyExists()))
      administrationClient
        .setup(a => a.createSubscription(It.isAny(), It.isAny(), It.isAny()))
        .returns(async () => Promise.reject(alreadyExists()))
      // The service queue doesn't forward its dead letters yet
      administrationClient
        .setup(a => a.getQueue('orders'))
        .returns(
          async () =>
            ({
              name: 'orders',
              lockDuration: 'PT1M',
              maxDeliveryCount: 10
            }) as any
        )
      // Service Bus reports where a subscription forwards to as a URL
      administrationClient
        .setup(a => a.getSubscription(It.isAny(), It.isAny()))
        .returns(
          async () =>
            ({
              forwardTo: 'sb://ns.servicebus.windows.net/Orders',
              forwardDeadLetteredMessagesTo:
                'sb://ns.servicebus.windows.net/orders-dead-letter'
            }) as any
        )
      const sut = new AzureServiceBusTransport(
        configuration,
        undefined,
        administrationClient.object
      )
      prepare(sut)
      await sut.provision(provisionOptions())
    })

    it('should update a queue whose settings differ', () => {
      administrationClient.verify(
        a =>
          a.updateQueue(
            It.isObjectWith({
              name: 'orders',
              forwardDeadLetteredMessagesTo: 'orders-dead-letter'
            }) as any
          ),
        Times.once()
      )
    })

    it('should leave subscriptions that already forward to the queue as they are', () => {
      administrationClient.verify(
        a => a.updateSubscription(It.isAny()),
        Times.never()
      )
    })
  })

  describe('when publishing to a topic that does not exist', () => {
    let error: unknown

    beforeAll(async () => {
      const { sut, sender } = await startedTransport()
      sender
        .setup(s => s.sendMessages(It.isAny()))
        .returns(async () =>
          Promise.reject(serviceBusError('MessagingEntityNotFound'))
        )
      error = await sut.publish(new TestEvent()).catch(e => e)
    })

    it('should throw ResourcesNotProvisioned naming the topic', () => {
      expect(error).toBeInstanceOf(ResourcesNotProvisioned)
      expect((error as ResourcesNotProvisioned).missingResources).toEqual([
        'Service Bus topic node-ts-bus-azure-service-bus-test-event'
      ])
    })
  })

  describe('when Service Bus rejects a message as too large', () => {
    let error: unknown

    beforeAll(async () => {
      const { sut, sender } = await startedTransport()
      sender
        .setup(s => s.sendMessages(It.isAny()))
        .returns(async () =>
          Promise.reject(serviceBusError('MessageSizeExceeded'))
        )
      error = await sut.publish(new TestEvent()).catch(e => e)
    })

    it('should throw AzureServiceBusMessageTooLarge naming the message', () => {
      expect(error).toBeInstanceOf(AzureServiceBusMessageTooLarge)
      expect(error).toMatchObject({ messageName: TestEvent.NAME })
    })
  })

  describe('when returning a message', () => {
    const raw = receivedMessage()
    let scheduled: ServiceBusMessage
    let scheduledFor: Date
    let receiver: IMock<ServiceBusReceiver>
    const returnedAt = Date.now()

    beforeAll(async () => {
      const started = await startedTransport()
      receiver = started.receiver
      started.sender
        .setup(s => s.scheduleMessages(It.isAny(), It.isAny()))
        .callback((message: ServiceBusMessage, at: Date) => {
          scheduled = message
          scheduledFor = at
        })
        .returns(async () => [])
      await started.sut.returnMessage(toTransportMessage(raw, 2), 5_000)
    })

    it('should schedule a copy for the delay from now', () => {
      expect(scheduledFor.getTime()).toBeGreaterThanOrEqual(returnedAt + 5_000)
      expect(scheduled.body).toEqual(raw.body)
    })

    it('should count one more failed attempt on the copy', () => {
      expect(scheduled.applicationProperties).toMatchObject({
        failedAttempts: 3,
        messageId: 'message-1',
        'attributes.a': 1
      })
    })

    it("should give the copy a native message id of the bus' id and the attempt", () => {
      expect(scheduled.messageId).toEqual('message-1:3')
    })

    it('should complete the original', () => {
      receiver.verify(r => r.completeMessage(raw), Times.once())
    })
  })

  describe('when failing a message', () => {
    const raw = receivedMessage()
    const failure: MessageFailure = {
      error: { name: 'ValidationError', message: 'Bad input' },
      failedAttempts: 3,
      endpoint: 'orders',
      messageId: 'message-1',
      failedAt: new Date().toISOString()
    }
    let options: Record<string, unknown>

    beforeAll(async () => {
      const { sut, receiver } = await startedTransport()
      receiver
        .setup(r => r.deadLetterMessage(It.isAny(), It.isAny()))
        .callback((_, deadLetterOptions: Record<string, unknown>) => {
          options = deadLetterOptions
        })
        .returns(async () => undefined)
      await sut.fail(toTransportMessage(raw), failure)
    })

    it('should dead-letter it with the error as the reason and description', () => {
      expect(options).toMatchObject({
        deadLetterReason: 'ValidationError',
        deadLetterErrorDescription: 'Bad input'
      })
    })

    it('should add the failure metadata', () => {
      expect(
        fromFailureHeader(options[FAILURE_HEADER] as string)
      ).toMatchObject(failure)
    })

    it('should reset its failed attempts, so a replay starts again', () => {
      expect(options.failedAttempts).toEqual(0)
    })
  })

  describe('when reading a message whose body can not be parsed', () => {
    let result: unknown
    let deadLetterOptions: Record<string, unknown>

    beforeAll(async () => {
      const client = Mock.ofType<ServiceBusClient>()
      const receiver = Mock.ofType<ServiceBusReceiver>()
      client
        .setup(c => c.createReceiver(It.isAny(), It.isAny()))
        .returns(() => receiver.object)
      receiver
        .setup(r => r.deadLetterMessage(It.isAny(), It.isAny()))
        .callback((_, options: Record<string, unknown>) => {
          deadLetterOptions = options
        })
        .returns(async () => undefined)
      receiver
        .setup(r => r.subscribe(It.isAny(), It.isAny()))
        .callback(({ processMessage }) => {
          // Not awaited: the callback is held until the message is settled
          void processMessage(
            receivedMessage({ body: Buffer.from('not json') })
          )
        })
        .returns(() => ({ close: async () => undefined }))
      const sut = new AzureServiceBusTransport(configuration, client.object)
      prepare(sut)
      await sut.connect({ concurrency: 1 })
      await sut.start()
      result = await sut.readNextMessage()
    })

    it('should return nothing', () => {
      expect(result).toBeUndefined()
    })

    it('should dead-letter it with the parse error', () => {
      expect(
        fromFailureHeader(deadLetterOptions[FAILURE_HEADER] as string)
      ).toMatchObject({
        endpoint: 'orders',
        messageId: 'message-1',
        failedAttempts: 1
      })
    })
  })

  describe('when the transport stops while a read is waiting', () => {
    let result: unknown

    beforeAll(async () => {
      const { sut } = await startedTransport()
      const read = sut.readNextMessage()
      await sut.stop()
      result = await read
    })

    it('should release the read with nothing', () => {
      expect(result).toBeUndefined()
    })
  })
})
