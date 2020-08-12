# IoC

Internally `@node-ts/bus` uses [Inversify](https://github.com/inversify/InversifyJS) as its inversion of control (IoC) framework. Your application is free to use its own IoC framework or none at all, yet still have access to all objects managed by the internal bus IoC container using the `getInstance()` helper function.

## Getting object instances with `getInstance()`

`getInstance()` lets you get an instance of a class managed by the internal `@node-ts/bus` IoC framework. Calling this with the registration symbol of the object you want will return an instance of that class. For example, if you want to get an instance of `Bus` (which is registered with the `BUS_SYMBOLS.Bus` symbol), you'd do something like:

```typescript
import { getInstance, BUS_SYMBOLS, Bus } from '@node-ts/bus-core'

const busInstance = getInstance<Bus>(BUS_SYMBOLS.Bus)
```

## Using `@node-ts/bus` with Inversify

If your application uses Inversify, the easiest way to integrate with the container created for `@node-ts/bus` is to merge it with your own.

For example:

```typescript
import { BusContainer } from '@node-ts/bus-core'
import { Container } from 'inversify'

// Load container with bindings
const myContainer = new Container()

// Create an application-level container that combines all bindings from bus and my container
const applicationContainer = Container.merge(BusContainer.instance, myContainer)
```
