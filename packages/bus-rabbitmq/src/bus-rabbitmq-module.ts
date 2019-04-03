import { ContainerModule } from 'inversify'
import { BUS_RABBITMQ_INTERNAL_SYMBOLS, BUS_RABBITMQ_SYMBOLS } from './bus-rabbitmq-symbols'
import { connect } from 'amqplib'
import { RabbitMqTransport } from './rabbitmq-transport'
import { bindLogger } from '@node-ts/logger-core';
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'

export class BusRabbitMqModule extends ContainerModule {
  constructor () {
    super (async bind => {
      bind(BUS_RABBITMQ_INTERNAL_SYMBOLS.RabbitMqTransport)
        .to(RabbitMqTransport)
        .inSingletonScope()
      bindLogger(bind, RabbitMqTransport)

      bind(BUS_RABBITMQ_INTERNAL_SYMBOLS.AmqpFactory)
        .toFactory(c => async () => {
          const configuration = c.container
            .get<RabbitMqTransportConfiguration>(BUS_RABBITMQ_SYMBOLS.TransportConfiguration)
          return connect(configuration.connectionString)
        })
    })
  }
}
