---
'@node-ts/bus-nestjs': minor
'@node-ts/bus-cli': minor
'@node-ts/bus-core': minor
---

Add `@node-ts/bus-nestjs`, a NestJS module for the bus (#268), for NestJS 11 and 12.

- `BusModule.forRoot({ configure })` and `BusModule.forRootAsync({ imports, inject, useFactory })` register a bus, configured by a factory that's given a `BusConfiguration` (logging through Nest's `Logger`, with no interrupt signals) and returns it with the transport, persistence and message types. The bus is injected as `BusInstance`; named buses with `@InjectBus(name)` and `getBusToken(name)`.
- Class handlers and workflows are providers, registered with `@BusHandler()` and `@BusWorkflow()` or `BusModule.forFeature()`, and resolved from Nest's container for each message by `nestContainer(moduleRef)`. Function handlers and `defineWorkflow()` workflows are registered with `BusModule.forFeatureAsync()`, given the providers they close over. Request-scoped providers get a request scope per received message, with the message and its attributes as Nest's `REQUEST` (`BusRequest`).
- The bus is built when the application initializes, initialized and started when it bootstraps (or by the application, with `lifecycle: 'manual'`), stopped in `onModuleDestroy` and disposed in `onApplicationShutdown`. Startup fails with `HandlerNotProvided`, `BusNotRegistered`, `BusAlreadyRegistered` or `BusFeatureNotStatic` naming the fix.
- `createBusForProvisioning(AppModule)` returns the application's bus, built but not initialized, for `bus provision`.

`bus provision` in `@node-ts/bus-cli` also accepts a module that exports a built, uninitialized bus, or a function that returns one, and exits once it has printed its report, even if the module left handles open. `BusInstance.canStart` in `@node-ts/bus-core` says whether `start()` can be called: false for a send-only bus or one with a `Receiver`.
