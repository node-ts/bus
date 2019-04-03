import { ContainerModule } from 'inversify'
import { BUS_RABBITMQ_INTERNAL_SYMBOLS } from './bus-rabbitmq-symbols'
import { connect } from 'amqplib'
import { RabbitMqTransport } from './rabbitmq-transport'

export class BusRabbitMqModule extends ContainerModule {
  constructor () {
    super (async bind => {
      bind(BUS_RABBITMQ_INTERNAL_SYMBOLS.RabbitMqTransport)
        .to(RabbitMqTransport)
        .inSingletonScope()

      bind(BUS_RABBITMQ_INTERNAL_SYMBOLS.AmqpFactory)
        .toFactory(c => async () => connect('amqp://admin:password@localhost'))
    })
  }
}
