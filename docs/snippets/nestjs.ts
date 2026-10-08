import {
  INestApplication,
  Inject,
  Injectable,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Scope
} from '@nestjs/common'
import { NestFactory, REQUEST } from '@nestjs/core'
import { BusInstance, Handler, handlerFor } from '@node-ts/bus-core'
import {
  BusHandler,
  BusModule,
  BusRequest,
  InjectBus,
  createBusForProvisioning
} from '@node-ts/bus-nestjs'
import { RabbitMqTransport } from '@node-ts/bus-rabbitmq'
import 'reflect-metadata'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard, CreditCardCharged } from './messages'

/**
 * Stands in for the application's own configuration service
 */
@Injectable()
export class AppConfig {
  readonly rabbitMqUrl = 'amqp://guest:guest@localhost'
}

@Module({ providers: [AppConfig], exports: [AppConfig] })
export class AppConfigModule {}

// #region payment-gateway
@Injectable()
export class PaymentGateway {
  async charge(_creditCardToken: string, _amount: number): Promise<void> {}
}

@Injectable()
export class Receipts {
  async record(_creditCardToken: string, _amount: number): Promise<void> {}
}

@Module({
  providers: [PaymentGateway, Receipts],
  exports: [PaymentGateway, Receipts]
})
export class PaymentGatewayModule {}
// #endregion payment-gateway

// #region class-handler
@BusHandler()
@Injectable()
export class ChargeCreditCardHandler implements Handler<ChargeCreditCard> {
  constructor(private readonly gateway: PaymentGateway) {}

  get messageType() {
    return ChargeCreditCard
  }

  async handle(command: ChargeCreditCard) {
    await this.gateway.charge(command.creditCardToken, command.amount)
  }
}
// #endregion class-handler

// #region function-handler
export const creditCardChargedHandler = (receipts: Receipts) =>
  handlerFor(CreditCardCharged, async event =>
    receipts.record(event.creditCardToken, event.amount)
  )
// #endregion function-handler

// #region feature-module
@Module({
  imports: [
    PaymentGatewayModule,
    // Function handlers and workflows, declared with the providers they need
    BusModule.forFeatureAsync({
      imports: [PaymentGatewayModule],
      inject: [Receipts],
      useFactory: (receipts: Receipts) => ({
        handlers: [creditCardChargedHandler(receipts)]
      })
    })
  ],
  // Class handlers are providers, found by @BusHandler()
  providers: [ChargeCreditCardHandler]
})
export class PaymentsModule {}
// #endregion feature-module

// #region for-feature
@Module({
  imports: [
    PaymentGatewayModule,
    // Registers the handler with the bus, without @BusHandler()
    BusModule.forFeature({ handlers: [ChargeCreditCardHandler] })
  ],
  // It's still a provider of the module
  providers: [ChargeCreditCardHandler]
})
export class PaymentsWithoutDecoratorsModule {}
// #endregion for-feature

// #region app-module
@Module({
  imports: [
    BusModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (bus, config: AppConfig) =>
        bus.withMessageTypes(messageTypes).withTransport(
          new RabbitMqTransport({
            queueName: 'payments-service',
            deadLetterQueueName: 'payments-service-dead-letter',
            connectionString: config.rabbitMqUrl
          })
        )
    }),
    PaymentsModule
  ]
})
export class AppModule {}
// #endregion app-module

const bootstrap = async () => {
  // #region main
  // src/main.ts
  const app = await NestFactory.create(AppModule)
  // Without it, a SIGTERM ends the process without stopping the bus, so the messages it's handling are retried
  app.enableShutdownHooks()
  await app.listen(3000)
  // #endregion main
}

// #region inject-bus
@Injectable()
export class CheckoutService {
  constructor(private readonly bus: BusInstance) {}

  async checkout(creditCardToken: string, amount: number) {
    await this.bus.send(new ChargeCreditCard(creditCardToken, amount))
  }
}
// #endregion inject-bus

// #region named-buses
@Module({
  imports: [
    BusModule.forRoot({
      configure: bus => bus.withMessageTypes(messageTypes)
    }),
    BusModule.forRoot({
      name: 'billing',
      configure: bus => bus.withMessageTypes(messageTypes)
    })
  ]
})
export class TwoBusesModule {}

@BusHandler({ bus: 'billing' })
@Injectable()
export class InvoiceHandler implements Handler<CreditCardCharged> {
  get messageType() {
    return CreditCardCharged
  }

  async handle() {}
}

@Injectable()
export class InvoiceService {
  constructor(@InjectBus('billing') private readonly billingBus: BusInstance) {}
}
// #endregion named-buses

// #region request-scope
@Injectable({ scope: Scope.REQUEST })
export class MessageAudit {
  constructor(@Inject(REQUEST) private readonly request: BusRequest) {}

  get messageId() {
    return this.request.attributes?.messageId
  }
}
// #endregion request-scope

// #region manual-lifecycle
@Module({
  imports: [
    BusModule.forRoot({
      lifecycle: 'manual',
      configure: bus => bus.withMessageTypes(messageTypes)
    })
  ]
})
export class ManualModule {}

@Injectable()
export class StartBusAfterWarmUp implements OnApplicationBootstrap {
  constructor(private readonly bus: BusInstance) {}

  async onApplicationBootstrap() {
    // ...once the application is ready to handle messages
    await this.bus.initialize()
    await this.bus.start()
  }
}
// #endregion manual-lifecycle

// #region release-resources
@Injectable()
export class DatabasePool implements OnApplicationShutdown {
  async query(_sql: string): Promise<unknown[]> {
    return []
  }

  // Not onModuleDestroy, which runs before the bus has finished the messages it's handling
  async onApplicationShutdown() {
    // ...close the pool
  }
}
// #endregion release-resources

const shutDown = async (app: INestApplication) => {
  // #region manual-stop
  // Stop taking messages and finish those being handled, then shut the rest of the application down
  await app.get(BusInstance).stop()
  await app.close()
  // #endregion manual-stop
}

// #region provisioning
// src/provision-bus.ts, run with `bus provision dist/provision-bus.js`
export default () => createBusForProvisioning(AppModule)
// #endregion provisioning

await bootstrap()
await shutDown(await NestFactory.create(AppModule))
