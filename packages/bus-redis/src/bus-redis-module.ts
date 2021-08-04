import { ContainerModule } from 'inversify'
import { BUS_REDIS_INTERNAL_SYMBOLS, BUS_REDIS_SYMBOLS } from './bus-redis-symbols'
import { RedisMessage, RedisTransport } from './redis-transport'
import { bindLogger } from '@node-ts/logger-core'
import { RedisTransportConfiguration } from './redis-transport-configuration'
import { BUS_SYMBOLS, Transport } from '@node-ts/bus-core'
import Redis from 'ioredis'

export class BusRedisModule extends ContainerModule {
  constructor () {
    super (async (bind, _, __, rebind) => {
      bind(BUS_REDIS_INTERNAL_SYMBOLS.RedisTransport)
        .to(RedisTransport)
        .inSingletonScope()
      bindLogger(bind, RedisTransport)

      rebind<Transport<RedisMessage>>(BUS_SYMBOLS.Transport)
        .toDynamicValue(c => c.container.get<RedisTransport>(BUS_REDIS_INTERNAL_SYMBOLS.RedisTransport))

      bind(BUS_REDIS_INTERNAL_SYMBOLS.RedisFactory)
        .toFactory(c => async () => {
          const configuration = c.container
            .get<RedisTransportConfiguration>(BUS_REDIS_SYMBOLS.TransportConfiguration)
          return new Redis(configuration.connectionString)
        })

    })
  }
}
