# Persistence

Persistence allows [@node-ts/bus-workflow](/packages/bus-workflow/) to maintain durable state in an underlying provider, and therefore run as a stateless service. This is important for a number of reasons:

1. The workflow service can be treated as an ephemeral service that can be scaled in and out at will
2. Execution of each workflow can be handled by a pool of distributed workflow services
3. Workflow state will persist regardless of how many services are running, if any

By default, [@node-ts/bus-workflow](/packages/bus-workflow/) uses an in-memory persistence provider. This is fine to use when playing with the package and doing casual development, however it's not intended for production use as the state won't survive a process restart.

The following persistence providers are currently available:

* [@node-ts/bus-postgres](/packages/bus-postgres/)

## Implementing a Persistence

Implementing a new transport is relatively simple (and encouraged!). This can be done by implementing the [Persistence<>](https://github.com/node-ts/bus/blob/master/packages/bus-workflow/src/workflow/persistence/persistence.ts) interface from `@node-ts/bus-workflow`. If you'd like to contribute your persistence adapter back to `@node-ts/bus` then please fork this repo, add a new package at `/packages/bus-<persistence-name>` and create a PR back to this repository.

Persistence adapters should be created and then registered in a new inversify module so that they consumers can use the persistence just by loading the module.

For an example of a persistence implementation, see the code for the [@node-ts/bus-postgres](https://github.com/node-ts/bus/blob/master/packages/bus-postgres/) persistence adapter.
