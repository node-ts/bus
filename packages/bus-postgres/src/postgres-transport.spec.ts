import {
  CoreDependencies,
  DefaultHandlerRegistry,
  EndpointNotFound,
  FAILURE_HEADER,
  JsonSerializer,
  Logger,
  MessageSerializer,
  ProvisioningPlan,
  TransportHeaderReserved,
  TransportMessage
} from '@node-ts/bus-core'
import { Command } from '@node-ts/bus-messages'
import { Pool, QueryResult } from 'pg'
import { IMock, It, Mock, Times } from 'typemoq'
import { InvalidSchemaName, InvalidTransportDuration } from './error'
import { PostgresTransport } from './postgres-transport'
import { PostgresTransportMessage } from './postgres-transport-message'

class TestTransportCommand extends Command {
  static NAME = '@node-ts/bus-postgres/test-transport-command'
  $name = TestTransportCommand.NAME
  $version = 0
}

const configuration = {
  queueName: 'orders',
  schemaName: 'bus',
  connection: {}
}

/**
 * A pool whose queries all return `rowCount` rows and no data
 */
const poolReturning = (rowCount: number): IMock<Pool> => {
  const pool = Mock.ofType<Pool>()
  pool
    .setup(p => p.query(It.isAnyString(), It.isAny()))
    .returns(
      async () => ({ rowCount, rows: [] }) as unknown as QueryResult as never
    )
  return pool
}

describe('PostgresTransport', () => {
  let sut: PostgresTransport
  let pool: IMock<Pool>
  let logger: IMock<Logger>

  const prepare = () => {
    logger = Mock.ofType<Logger>()
    sut.prepare({
      loggerFactory: () => logger.object,
      messageSerializer: new MessageSerializer(
        new JsonSerializer(),
        new DefaultHandlerRegistry(),
        { messages: {}, types: {} }
      )
    } as unknown as CoreDependencies)
  }

  describe('when a send-only bus provisions as a dry run', () => {
    let plan: ProvisioningPlan

    beforeAll(async () => {
      pool = Mock.ofType<Pool>()
      sut = new PostgresTransport(configuration, pool.object)
      prepare()
      plan = await sut.provision({
        handlerRegistry: new DefaultHandlerRegistry(),
        sendOnly: true,
        messageNames: [TestTransportCommand.NAME],
        sendsAnyMessage: false,
        dryRun: true
      })
    })

    it('should not query postgres', () => {
      pool.verify(p => p.query(It.isAny()), Times.never())
    })

    it('should plan the schema, tables and index, without a queue or subscriptions', () => {
      expect(plan.resources.map(({ type, name }) => `${type} ${name}`)).toEqual(
        [
          'postgres-schema bus',
          'postgres-table "bus"."transport_messages"',
          'postgres-index transport_messages_queue_visible_at_idx',
          'postgres-table "bus"."transport_queues"',
          'postgres-table "bus"."transport_subscriptions"',
          'postgres-table "bus"."transport_dead_letters"'
        ]
      )
    })

    it('should not grant inserting dead letters', () => {
      expect(plan.runtimePermissions?.document).toEqual([
        'GRANT USAGE ON SCHEMA "bus" TO <runtime_role>;',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON "bus"."transport_messages" TO <runtime_role>;',
        'GRANT SELECT ON "bus"."transport_queues" TO <runtime_role>;',
        'GRANT SELECT ON "bus"."transport_subscriptions" TO <runtime_role>;'
      ])
    })
  })

  describe('when constructed with a duration that is not positive', () => {
    const errors: unknown[] = []

    beforeAll(() => {
      for (const setting of [
        { pollIntervalMs: 0 },
        { visibilityTimeoutMs: -1 },
        { pollIntervalMs: Number.NaN }
      ]) {
        try {
          new PostgresTransport(
            { ...configuration, ...setting },
            Mock.ofType<Pool>().object
          )
        } catch (error) {
          errors.push(error)
        }
      }
    })

    it('should throw InvalidTransportDuration naming the setting', () => {
      expect(errors).toHaveLength(3)
      errors.forEach(error =>
        expect(error).toBeInstanceOf(InvalidTransportDuration)
      )
      expect(
        errors.map(error => (error as InvalidTransportDuration).setting)
      ).toEqual(['pollIntervalMs', 'visibilityTimeoutMs', 'pollIntervalMs'])
    })
  })

  describe('when initialized with an empty schema name', () => {
    let error: unknown

    beforeAll(async () => {
      sut = new PostgresTransport(
        { ...configuration, schemaName: '' },
        Mock.ofType<Pool>().object
      )
      prepare()
      try {
        await sut.initialize({
          handlerRegistry: new DefaultHandlerRegistry(),
          sendOnly: false,
          messageNames: [],
          verifyResources: true,
          autoProvision: false
        })
      } catch (e) {
        error = e
      }
    })

    it('should throw InvalidSchemaName', () => {
      expect(error).toBeInstanceOf(InvalidSchemaName)
    })
  })

  describe('when checking send options', () => {
    beforeAll(() => {
      sut = new PostgresTransport(configuration, Mock.ofType<Pool>().object)
      prepare()
    })

    it('should reject the bus-failure header', () => {
      expect(() =>
        sut.assertSendOptions({ headers: { [FAILURE_HEADER]: 'x' } })
      ).toThrow(TransportHeaderReserved)
    })

    it('should accept other headers', () => {
      expect(() =>
        sut.assertSendOptions({ headers: { traceparent: 'x' } })
      ).not.toThrow()
    })
  })

  describe('when sending to an address with no queue', () => {
    let error: unknown

    beforeAll(async () => {
      sut = new PostgresTransport(configuration, poolReturning(0).object)
      prepare()
      try {
        await sut.sendToAddress('missing', new TestTransportCommand())
      } catch (e) {
        error = e
      }
    })

    it('should throw EndpointNotFound naming the address', () => {
      expect(error).toBeInstanceOf(EndpointNotFound)
      expect((error as EndpointNotFound).address).toEqual('missing')
    })
  })

  describe('when publishing a message no queue is subscribed to', () => {
    beforeAll(async () => {
      sut = new PostgresTransport(configuration, poolReturning(0).object)
      prepare()
      await sut.publish(new TestTransportCommand())
    })

    it('should warn that it was dropped', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(message => message.includes('dropped')),
            It.isObjectWith({ messageName: TestTransportCommand.NAME })
          ),
        Times.once()
      )
    })
  })

  describe('when deleting a message whose visibility timeout ended', () => {
    beforeAll(async () => {
      pool = poolReturning(0)
      sut = new PostgresTransport(configuration, pool.object)
      prepare()
      await sut.deleteMessage({
        raw: {
          id: 'message-id',
          leaseToken: 'lease-token',
          attributes: { messageId: 'bus-message-id' }
        }
      } as unknown as TransportMessage<PostgresTransportMessage>)
    })

    it('should only delete it while it holds its lease', () => {
      pool.verify(
        p =>
          p.query(
            It.is<string>(sql => sql.includes('lease_token = $2')),
            It.isValue(['message-id', 'lease-token'])
          ),
        Times.once()
      )
    })

    it('should warn that it may be handled again', () => {
      logger.verify(
        l =>
          l.warn(
            It.is<string>(message => message.includes('visibilityTimeoutMs')),
            It.isObjectWith({ messageId: 'bus-message-id' })
          ),
        Times.once()
      )
    })
  })
})
