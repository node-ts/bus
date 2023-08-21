import { ContainerModule } from 'inversify'
import { BUS_SQS_INTERNAL_SYMBOLS } from './bus-sqs-symbols'
import { bindLogger } from '@node-ts/logger-core'
import { BUS_SYMBOLS, Transport } from '@node-ts/bus-core'
import { SqsTransport } from './sqs-transport'
import { Message, SQS } from '@aws-sdk/client-sqs'
import { SNS } from '@aws-sdk/client-sns'

export class BusSqsModule extends ContainerModule {
  constructor () {
    super (async (bind, _, __, rebind) => {
      bind(BUS_SQS_INTERNAL_SYMBOLS.SqsTransport)
        .to(SqsTransport)
        .inSingletonScope()
      bindLogger(bind, SqsTransport)

      rebind<Transport<Message>>(BUS_SYMBOLS.Transport)
        .toDynamicValue(c => c.container.get<SqsTransport>(BUS_SQS_INTERNAL_SYMBOLS.SqsTransport))

      bind(BUS_SQS_INTERNAL_SYMBOLS.Sqs)
        .toConstantValue(new SQS())

      bind(BUS_SQS_INTERNAL_SYMBOLS.Sns)
        .toConstantValue(new SNS())

    })
  }
}
