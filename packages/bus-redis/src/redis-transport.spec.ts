import {
  CoreDependencies,
  DefaultHandlerRegistry,
  FAILURE_HEADER,
  HandlerRegistry,
  JsonSerializer,
  Logger,
  MessageSerializer,
  ProvisioningPlan,
  TransportHeaderReserved
} from '@node-ts/bus-core'
import { Command } from '@node-ts/bus-messages'
import { Mock } from 'typemoq'
import {
  InvalidRedisKeyName,
  InvalidRedisTransportDuration,
  RedisTransportNotConnected
} from './error'
import { RedisTransport } from './redis-transport'

class TestTransportCommand extends Command {
  static NAME = '@node-ts/bus-redis/test-transport-command'
  $name = TestTransportCommand.NAME
  $version = 0
}

const configuration = {
  queueName: 'orders',
  connection: {}
}

const handlerRegistryFor = (
  messageNames: string[],
  externalTopics: string[] = []
): HandlerRegistry => {
  const registry = Mock.ofType<HandlerRegistry>()
  registry.setup(r => r.getMessageNames()).returns(() => messageNames)
  registry
    .setup(r => r.getExternallyManagedTopicIdentifiers())
    .returns(() => externalTopics)
  return registry.object
}

describe('RedisTransport', () => {
  let sut: RedisTransport

  const prepare = () => {
    sut.prepare({
      loggerFactory: () => Mock.ofType<Logger>().object,
      messageSerializer: new MessageSerializer(
        new JsonSerializer(),
        new DefaultHandlerRegistry(),
        { messages: {}, types: {} }
      )
    } as unknown as CoreDependencies)
  }

  describe('when a receiving bus provisions as a dry run', () => {
    let plan: ProvisioningPlan

    beforeAll(async () => {
      sut = new RedisTransport({ ...configuration, keyPrefix: 'app*' })
      prepare()
      // Not connected, so it would throw RedisTransportNotConnected if it called Redis
      plan = await sut.provision({
        handlerRegistry: handlerRegistryFor(
          [TestTransportCommand.NAME],
          ['external-topic']
        ),
        sendOnly: false,
        messageNames: [TestTransportCommand.NAME],
        sendsAnyMessage: false,
        dryRun: true
      })
    })

    it('should plan the stream, consumer group and a subscription per handled message and custom topic', () => {
      expect(plan.resources.map(({ type, name }) => `${type} ${name}`)).toEqual(
        [
          'redis-stream app*:{orders}:queue',
          'redis-consumer-group orders',
          `redis-subscription ${TestTransportCommand.NAME} -> orders`,
          'redis-subscription external-topic -> orders'
        ]
      )
    })

    it('should list the ACL rules it needs at runtime, with key patterns escaped', () => {
      expect(plan.runtimePermissions).toEqual({
        format: 'redis-acl',
        document: {
          user: '<runtime_user>',
          rules: [
            '~app\\*:{orders}:*',
            '%W~app\\*:{*}:queue',
            '%R~app\\*:subscriptions:*',
            '+xadd',
            '+smembers',
            '+multi',
            '+exec',
            '+ping',
            '+xreadgroup',
            '+xack',
            '+xdel',
            '+xpending',
            '+xclaim',
            '+xinfo|groups',
            '+xinfo|consumers',
            '+xgroup|delconsumer',
            '+zadd',
            '+zrange',
            '+zrangebyscore',
            '+zrem',
            '+sismember',
            '+time',
            '+evalsha',
            '+eval'
          ]
        }
      })
    })
  })

  describe('when a send-only bus provisions', () => {
    let plan: ProvisioningPlan

    beforeAll(async () => {
      sut = new RedisTransport(configuration)
      prepare()
      // Not a dry run, but a send-only bus has nothing to create, so it doesn't call Redis
      plan = await sut.provision({
        handlerRegistry: handlerRegistryFor([]),
        sendOnly: true,
        messageNames: [TestTransportCommand.NAME],
        sendsAnyMessage: true,
        dryRun: false
      })
    })

    it('should plan no resources', () => {
      expect(plan.resources).toEqual([])
    })

    it('should only allow sending at runtime', () => {
      expect(plan.runtimePermissions?.document).toEqual({
        user: '<runtime_user>',
        rules: [
          '%W~bus:{*}:queue',
          '%R~bus:subscriptions:*',
          '+xadd',
          '+smembers',
          '+multi',
          '+exec',
          '+ping'
        ]
      })
    })
  })

  describe('when constructed with a queue name or key prefix it cannot use', () => {
    const errors: unknown[] = []

    beforeAll(() => {
      for (const settings of [
        { queueName: '' },
        { queueName: 'orders{1}' },
        { keyPrefix: 'bus}' }
      ]) {
        try {
          new RedisTransport({ ...configuration, ...settings })
        } catch (error) {
          errors.push(error)
        }
      }
    })

    it('should throw InvalidRedisKeyName naming the setting', () => {
      expect(errors).toHaveLength(3)
      errors.forEach(error => expect(error).toBeInstanceOf(InvalidRedisKeyName))
      expect((errors as InvalidRedisKeyName[]).map(e => e.setting)).toEqual([
        'queueName',
        'queueName',
        'keyPrefix'
      ])
    })
  })

  describe('when constructed with a duration it cannot use', () => {
    const errors: unknown[] = []

    beforeAll(() => {
      for (const settings of [
        { visibilityTimeoutMs: 0 },
        { visibilityTimeoutMs: Infinity },
        // Redis takes idle times as integers
        { visibilityTimeoutMs: 1500.5 },
        { deadLetterRetentionMs: -1 },
        { deadLetterRetentionMs: Number.NaN },
        { deadLetterRetentionMs: 1500.5 }
      ]) {
        try {
          new RedisTransport({ ...configuration, ...settings })
        } catch (error) {
          errors.push(error)
        }
      }
    })

    it('should throw InvalidRedisTransportDuration naming the setting', () => {
      expect(
        (errors as InvalidRedisTransportDuration[]).map(e => e.setting)
      ).toEqual([
        'visibilityTimeoutMs',
        'visibilityTimeoutMs',
        'visibilityTimeoutMs',
        'deadLetterRetentionMs',
        'deadLetterRetentionMs',
        'deadLetterRetentionMs'
      ])
    })
  })

  describe('when constructed with a dead letter retention of 0 or Infinity', () => {
    const errors: unknown[] = []

    beforeAll(() => {
      for (const deadLetterRetentionMs of [0, Infinity]) {
        try {
          new RedisTransport({ ...configuration, deadLetterRetentionMs })
        } catch (error) {
          errors.push(error)
        }
      }
    })

    it('should accept it', () => {
      expect(errors).toEqual([])
    })
  })

  describe('when checking send options', () => {
    beforeAll(() => {
      sut = new RedisTransport(configuration)
    })

    it('should reject the bus-failure header', () => {
      expect(() =>
        sut.assertSendOptions({ headers: { [FAILURE_HEADER]: 'x' } })
      ).toThrow(TransportHeaderReserved)
    })

    it('should accept other headers', () => {
      expect(() =>
        sut.assertSendOptions({ headers: { 'x-tenant': 'a' } })
      ).not.toThrow()
    })
  })

  describe('when sending before it has connected', () => {
    let error: unknown

    beforeAll(async () => {
      sut = new RedisTransport(configuration)
      prepare()
      try {
        await sut.send(new TestTransportCommand())
      } catch (e) {
        error = e
      }
    })

    it('should throw RedisTransportNotConnected', () => {
      expect(error).toBeInstanceOf(RedisTransportNotConnected)
    })
  })
})
