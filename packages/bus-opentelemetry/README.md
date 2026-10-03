# @node-ts/bus-opentelemetry

[OpenTelemetry](https://opentelemetry.io/) tracing and metrics for [@node-ts/bus](https://node-ts.github.io/bus), as bus middleware. It traces each message from the service that sends it to every handler that handles it, over any transport, and records the messaging metrics.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-opentelemetry)](https://www.npmjs.com/package/@node-ts/bus-opentelemetry)

**[Documentation](https://node-ts.github.io/bus/guide/opentelemetry)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-opentelemetry/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-opentelemetry @opentelemetry/api @node-ts/bus-core
```

## Usage

Pass `openTelemetry()` to the bus configuration's `withMiddleware()`, once for each bus:

<!-- <<< @/snippets/opentelemetry.ts -->

```ts
import { Bus } from '@node-ts/bus-core'
import { openTelemetry } from '@node-ts/bus-opentelemetry'
import { RabbitMqTransport } from '@node-ts/bus-rabbitmq'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

// Start the OpenTelemetry SDK before this runs, so the bus uses its tracer and meter providers
const transport = new RabbitMqTransport({
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter',
  connectionString: 'amqp://guest:guest@localhost'
})

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(transport)
  .withHandler(reserveRoomHandler)
  .withMiddleware(
    openTelemetry({
      messagingSystem: 'rabbitmq',
      endpointName: transport.endpointName
    })
  )
  .build()

await bus.initialize()
await bus.start()
```

It uses the tracer provider, meter provider and propagator of the OpenTelemetry SDK you've set up, so start the SDK before the bus handles its first message.

## Learn more

- [OpenTelemetry](https://node-ts.github.io/bus/guide/opentelemetry): the spans, metrics, trace context and options
- [Middleware](https://node-ts.github.io/bus/guide/middleware)
