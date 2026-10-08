# @node-ts/bus-nestjs

A [NestJS](https://nestjs.com) module for [@node-ts/bus](https://node-ts.github.io/bus): class handlers and workflows are providers, resolved from Nest's container with their dependencies, and the bus is started and stopped with the application.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-nestjs)](https://www.npmjs.com/package/@node-ts/bus-nestjs)

**[Documentation](https://node-ts.github.io/bus/guide/nestjs)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-nestjs/CHANGELOG.md)

## Installation

Requires Node.js 24 or later. Works with NestJS 11 and 12.

```sh
npm i @node-ts/bus-nestjs @node-ts/bus-core
```

## Usage

Register the bus once, in the root module:

<!-- <<< @/snippets/nestjs.ts#app-module -->

```ts
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
```

Class handlers are providers, found by `@BusHandler()`:

<!-- <<< @/snippets/nestjs.ts#class-handler -->

```ts
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
```

The bus is initialized and started when the application bootstraps. Call `app.enableShutdownHooks()` so a `SIGTERM` stops it gracefully:

<!-- <<< @/snippets/nestjs.ts#main -->

```ts
// src/main.ts
const app = await NestFactory.create(AppModule)
// Without it, a SIGTERM ends the process without stopping the bus, so the messages it's handling are retried
app.enableShutdownHooks()
await app.listen(3000)
```

## Learn more

- [NestJS](https://node-ts.github.io/bus/guide/nestjs): function handlers, workflows, several buses, the lifecycle, request scope, provisioning and testing
- [Dependency injection](https://node-ts.github.io/bus/guide/dependency-injection)
- [Provisioning](https://node-ts.github.io/bus/guide/provisioning)
