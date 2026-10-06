import {
  CoreDependencies,
  Logger,
  ProvisioningPlan,
  TransportHeaderReserved,
  TransportProvisionOptions
} from '@node-ts/bus-core'
import { Mock } from 'typemoq'
import { RabbitMqResourceCheckRefused } from './error'
import { RabbitMqTransport } from './rabbitmq-transport'
import { TestCommand } from './test'

const reservedHeaderNames = [
  'attributes',
  'stickyAttributes',
  'sentAt',
  'failedAttempts',
  'x-death',
  'x-first-death-reason',
  'x-last-death-queue'
]

describe('RabbitMqTransport', () => {
  // The headers are checked before the transport connects, so no broker is needed
  const sut = new RabbitMqTransport({
    queueName: '@node-ts/bus-rabbitmq-reserved-header-test',
    connectionString: 'amqp://guest:guest@0.0.0.0'
  })

  describe.each(reservedHeaderNames)(
    'when checking send options with a header named %s',
    headerName => {
      let error: unknown

      beforeEach(() => {
        try {
          sut.assertSendOptions({ headers: { [headerName]: 'value' } })
        } catch (e) {
          error = e
        }
      })

      it('should throw TransportHeaderReserved', () => {
        expect(error).toBeInstanceOf(TransportHeaderReserved)
        expect(error).toMatchObject({
          headerName,
          transportName: 'RabbitMqTransport'
        })
      })
    }
  )

  describe.each(reservedHeaderNames)(
    'when sending a message with a header named %s',
    headerName => {
      let error: unknown

      beforeEach(async () => {
        error = await sut
          .send(
            new TestCommand('reserved'),
            { attributes: {}, stickyAttributes: {} },
            { headers: { [headerName]: 'value' } }
          )
          .catch((e: unknown) => e)
      })

      it('should throw TransportHeaderReserved', () => {
        expect(error).toBeInstanceOf(TransportHeaderReserved)
      })
    }
  )

  describe('when checking send options with headers the broker does not write', () => {
    let error: unknown

    beforeEach(() => {
      try {
        sut.assertSendOptions({ headers: { 'x-tenant': 'acme', 'x-delay': 5 } })
      } catch (e) {
        error = e
      }
    })

    it('should accept them', () => {
      expect(error).toBeUndefined()
    })
  })

  describe('when a dry run is provisioned', () => {
    const handlerRegistry = {
      getMessageNames: () => ['handled-message'],
      getExternallyManagedTopicIdentifiers: () => ['external-topic']
    } as any as TransportProvisionOptions['handlerRegistry']
    let plan: ProvisioningPlan

    // A dry run doesn't connect, so no broker is needed
    beforeAll(async () => {
      plan = await new RabbitMqTransport({
        queueName: 'orders',
        connectionString: 'amqp://guest:guest@0.0.0.0'
      }).provision({
        handlerRegistry,
        sendOnly: false,
        messageNames: ['handled-message', 'sent.message'],
        sendsAnyMessage: false,
        dryRun: true
      })
    })

    it('should plan an exchange for each message and external topic', () => {
      const exchanges = plan.resources
        .filter(({ type }) => type === 'rabbitmq-exchange')
        .map(({ name }) => name)
      expect(exchanges).toEqual([
        'orders-retry',
        'orders',
        'handled-message',
        'sent.message',
        'external-topic'
      ])
    })

    it('should plan the service, dead letter and every retry queue', () => {
      const queues = plan.resources
        .filter(({ type }) => type === 'rabbitmq-queue')
        .map(({ name }) => name)
      expect(queues.slice(0, 3)).toEqual([
        'orders',
        'orders-retry',
        'dead-letter'
      ])
      expect(queues).toContain('orders-retry-1ms')
      expect(queues).toContain(`orders-retry-${2 ** 32}ms`)
      expect(queues).toHaveLength(3 + 33)
    })

    it('should plan each queue with the exact arguments it is declared with', () => {
      const queue = (name: string) =>
        plan.resources.find(
          resource =>
            resource.type === 'rabbitmq-queue' && resource.name === name
        )?.properties
      expect(queue('orders')).toEqual({
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'orders-retry',
          'x-dead-letter-routing-key': 'retry'
        }
      })
      expect(queue('orders-retry')).toEqual({
        durable: true,
        arguments: {
          'x-message-ttl': 1,
          'x-dead-letter-exchange': 'orders',
          'x-dead-letter-routing-key': ''
        }
      })
      expect(queue('dead-letter')).toEqual({ durable: true, arguments: {} })
      expect(queue('orders-retry-8ms')).toEqual({
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'orders',
          'x-dead-letter-routing-key': ''
        }
      })
    })

    it('should only bind the exchanges of handled messages to the service queue', () => {
      const boundExchanges = plan.resources
        .filter(
          ({ type, properties }) =>
            type === 'rabbitmq-binding' && properties?.queue === 'orders'
        )
        .map(({ properties }) => properties?.exchange)
      expect(boundExchanges).toEqual([
        'orders',
        'handled-message',
        'external-topic'
      ])
    })

    it('should need no configure permission at runtime', () => {
      expect(plan.runtimePermissions).toMatchObject({
        format: 'rabbitmq-permissions',
        document: { configure: '^$' }
      })
    })

    it('should only need write permission on the exchanges it publishes to', () => {
      const { write } = plan.runtimePermissions!.document as { write: string }
      const writable = new RegExp(write)
      expect(writable.test('amq.default')).toEqual(true)
      expect(writable.test('sent.message')).toEqual(true)
      expect(writable.test('sentXmessage')).toEqual(false)
      expect(writable.test('orders-retry')).toEqual(false)
    })

    it('should need read permission on its queues and their exchanges, which RabbitMQ 4.3.1 needs to check them', () => {
      const { read } = plan.runtimePermissions!.document as { read: string }
      const readable = new RegExp(read)
      expect(readable.test('orders')).toEqual(true)
      expect(readable.test('orders-retry')).toEqual(true)
      expect(readable.test('dead-letter')).toEqual(true)
      expect(readable.test('orders-retry-8ms')).toEqual(true)
      expect(readable.test(`orders-retry-${2 ** 32}ms`)).toEqual(true)
      expect(readable.test('orders-retry-8msx')).toEqual(false)
      expect(readable.test('other-service')).toEqual(false)
    })
  })

  describe('when RabbitMQ refuses a check', () => {
    const accessRefused = Object.assign(
      new Error('ACCESS_REFUSED - access to queue refused'),
      { code: 403 }
    )

    /**
     * A transport whose check channels refuse every passive declare
     */
    const refusingTransport = () => {
      const transport = new RabbitMqTransport({
        queueName: 'orders',
        connectionString: 'amqp://guest:guest@0.0.0.0'
      })
      transport.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object
      } as any as CoreDependencies)
      let checks = 0
      const channel = {
        on: () => undefined,
        close: async () => undefined,
        checkQueue: async () => {
          checks++
          throw accessRefused
        },
        checkExchange: async () => {
          checks++
          throw accessRefused
        }
      }
      transport['connection'] = {
        createChannel: async () => channel
      } as any
      return { transport, checks: () => checks }
    }

    const initializationOptions = (verifyResources: boolean) => ({
      handlerRegistry: {
        getMessageNames: () => [],
        getExternallyManagedTopicIdentifiers: () => []
      } as any as TransportProvisionOptions['handlerRegistry'],
      sendOnly: false,
      messageNames: [],
      verifyResources,
      autoProvision: false
    })

    describe('at startup', () => {
      let error: unknown

      beforeAll(async () => {
        const { transport } = refusingTransport()
        error = await transport
          .initialize(initializationOptions(true))
          .catch((e: unknown) => e)
      })

      it('should throw RabbitMqResourceCheckRefused naming what it checked', () => {
        expect(error).toBeInstanceOf(RabbitMqResourceCheckRefused)
        expect(error).toMatchObject({ kind: 'exchange', name: 'orders-retry' })
      })
    })

    describe('before a retry queue is first used', () => {
      let error: unknown

      beforeAll(async () => {
        const { transport } = refusingTransport()
        transport['verifyResources'] = true
        error = await transport['ensureRetryQueue'](
          {} as any,
          'orders-retry-8ms'
        ).catch((e: unknown) => e)
      })

      it('should throw RabbitMqResourceCheckRefused naming the queue', () => {
        expect(error).toBeInstanceOf(RabbitMqResourceCheckRefused)
        expect(error).toMatchObject({ kind: 'queue', name: 'orders-retry-8ms' })
      })
    })

    describe('and resources are not verified', () => {
      let checks: number
      let error: unknown

      beforeAll(async () => {
        const refusing = refusingTransport()
        error = await refusing.transport
          .initialize(initializationOptions(false))
          .then(async () =>
            refusing.transport['ensureRetryQueue'](
              {} as any,
              'orders-retry-8ms'
            )
          )
          .catch((e: unknown) => e)
        checks = refusing.checks()
      })

      it('should check nothing, at startup or before first use', () => {
        expect(error).toBeUndefined()
        expect(checks).toEqual(0)
      })
    })
  })

  describe('when a dry run is provisioned for a send-only bus', () => {
    let plan: ProvisioningPlan

    beforeAll(async () => {
      plan = await new RabbitMqTransport({
        queueName: '',
        connectionString: 'amqp://guest:guest@0.0.0.0'
      }).provision({
        handlerRegistry: {} as TransportProvisionOptions['handlerRegistry'],
        sendOnly: true,
        messageNames: ['sent-message'],
        sendsAnyMessage: false,
        dryRun: true
      })
    })

    it('should only plan an exchange for each message', () => {
      expect(plan.resources).toEqual([
        {
          type: 'rabbitmq-exchange',
          name: 'sent-message',
          properties: { type: 'fanout', durable: true }
        }
      ])
    })

    it('should only need write permission on those exchanges', () => {
      expect(plan.runtimePermissions?.document).toEqual({
        configure: '^$',
        write: '^(amq\\.default|sent-message)$',
        read: '^$'
      })
    })
  })

  describe('when a dry run is provisioned for a scheduler', () => {
    let plan: ProvisioningPlan

    beforeAll(async () => {
      plan = await new RabbitMqTransport({
        queueName: '',
        connectionString: 'amqp://guest:guest@0.0.0.0'
      }).provision({
        handlerRegistry: {} as TransportProvisionOptions['handlerRegistry'],
        sendOnly: true,
        messageNames: [],
        sendsAnyMessage: true,
        dryRun: true
      })
    })

    it('should need write permission on every exchange, since it sends any stored message', () => {
      expect(plan.runtimePermissions?.document).toMatchObject({
        configure: '^$',
        write: '.*'
      })
    })
  })
})
