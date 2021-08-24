import { ContainerModule } from 'inversify'
import { BUS_REDIS_INTERNAL_SYMBOLS } from './bus-redis-symbols'
import { RedisTransport } from './redis-transport'
import { bindLogger } from '@node-ts/logger-core'
import { BUS_SYMBOLS, Transport } from '@node-ts/bus-core'
import { Message as QueueMessage } from 'modest-queue'

export class BusRedisModule extends ContainerModule {
  constructor () {
    super (async (bind, _, __, rebind) => {
      bind(BUS_REDIS_INTERNAL_SYMBOLS.RedisTransport)
        .to(RedisTransport)
        .inSingletonScope()
      bindLogger(bind, RedisTransport)

      rebind<Transport<QueueMessage>>(BUS_SYMBOLS.Transport)
        .toDynamicValue(c => c.container.get<RedisTransport>(BUS_REDIS_INTERNAL_SYMBOLS.RedisTransport))
    })
  }
}
