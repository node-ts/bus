# Transports

Transports are the underlying message broker that `@node-ts/bus-core` uses to communicate. By default this package includes an in-memory queue, but can (and should) be replaced with a durable transport.

Currently adapters for two technologies are implemented and available for use:

* [@node-ts/bus-sqs](/packages/bus-sqs/)
* [@node-ts/bus-rabbitmq](/packages/bus-rabbitmq/)

## Implementing a Transport

Implementing a new transport is relatively simple (and encouraged!). This can be done by implementing the [Transport<>](https://github.com/node-ts/bus/blob/master/packages/bus-core/src/transport/transport.ts) interface from `@node-ts/bus-core`. If you'd like to contribute your transport adapter back to `@node-ts/bus` then please fork this repo, add a new package at `/packages/bus-<transport-name>` and create a PR back to this repository.

Transport adapters should be created and then registered in a new inversify module so that they consumers can use the transport just by loading the module.

For an example of a transport implementation, see the code for the [@node-ts/bus-sqs](https://github.com/node-ts/bus/blob/master/packages/bus-sqs/) transport.
