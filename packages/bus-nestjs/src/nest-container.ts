import { Scope } from '@nestjs/common'
import { ContextId, ContextIdFactory, ModuleRef } from '@nestjs/core'
import { ClassConstructor, ContainerAdapter } from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { BusRequest } from './bus-request'
import { BusClassNotProvided } from './error'

/**
 * Creates a `ContainerAdapter` that resolves class handlers and workflows from Nest's container. `BusModule`
 * configures each bus with one; use it directly to build a bus inside a Nest application without `BusModule`.
 *
 * Singleton providers are resolved with `moduleRef.get()`. Request-scoped and transient providers, and providers
 * that depend on them, are resolved with `moduleRef.resolve()` in a request scope of their own for each received
 * message, shared by every handler and workflow that handles it, with the message and its attributes registered
 * as Nest's `REQUEST` (see `BusRequest`).
 * @param moduleRef a `ModuleRef` from the application, which finds providers in any of its modules
 * @returns the adapter, for `withContainer()`
 * @throws BusClassNotProvided from `get`, when the class isn't a provider in the application
 * @example
 * Bus.configure().withContainer(nestContainer(app.get(ModuleRef)))
 */
export const nestContainer = (moduleRef: ModuleRef): ContainerAdapter => {
  // Keyed by the message object, so the handlers and workflows of one message share a scope. Received messages
  // are dropped once handled, which drops their scopes with them.
  const scopes = new WeakMap<object, ContextId>()

  const scopeFor = (
    message: Message | undefined,
    attributes: MessageAttributes | undefined
  ): ContextId => {
    if (typeof message !== 'object' || message === null) {
      return ContextIdFactory.create()
    }
    let contextId = scopes.get(message)
    if (!contextId) {
      contextId = ContextIdFactory.create()
      scopes.set(message, contextId)
      moduleRef.registerRequestByContextId<BusRequest>(
        { message, attributes },
        contextId
      )
    }
    return contextId
  }

  return {
    get<T>(
      type: ClassConstructor<T>,
      context?: { message?: Message; messageAttributes?: MessageAttributes }
    ): T | Promise<T> {
      let scope: Scope | undefined
      try {
        scope = moduleRef.introspect(type).scope
      } catch (error) {
        throw new BusClassNotProvided(type.name, error)
      }
      if (scope === Scope.DEFAULT) {
        return moduleRef.get(type, { strict: false })
      }
      return moduleRef.resolve(
        type,
        scopeFor(context?.message, context?.messageAttributes),
        { strict: false }
      )
    }
  }
}
