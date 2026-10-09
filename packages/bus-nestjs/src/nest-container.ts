import { Scope } from '@nestjs/common'
import { ContextId, ContextIdFactory, ModuleRef } from '@nestjs/core'
import {
  ClassConstructor,
  ContainerAdapter,
  ContainerContext
} from '@node-ts/bus-core'
import { BusRequest } from './bus-request'
import { BusClassNotProvided, WorkflowResolvedWithoutMessage } from './error'

/**
 * Creates a `ContainerAdapter` that resolves class handlers and workflows from Nest's container. `BusModule`
 * configures each bus with one; use it directly to build a bus inside a Nest application without `BusModule`.
 *
 * Singleton providers are resolved with `moduleRef.get()`. Request-scoped and transient providers, and providers
 * that depend on them, are resolved with `moduleRef.resolve()` in a request scope of their own for each delivery of
 * a message, shared by every handler and workflow that handles it, with the message and its attributes registered
 * as Nest's `REQUEST` (see `BusRequest`). A retry of the message is a new delivery, so it gets a new scope.
 * @param moduleRef a `ModuleRef` from the application, which finds providers in any of its modules
 * @returns the adapter, for `withContainer()`
 * @throws BusClassNotProvided from `get`, when the class isn't a provider in the application
 * @throws WorkflowResolvedWithoutMessage from `get`, when a request-scoped class workflow can't be created without a
 * message
 * @example
 * Bus.configure().withContainer(nestContainer(app.get(ModuleRef)))
 */
export const nestContainer = (moduleRef: ModuleRef): ContainerAdapter => {
  // Keyed by the delivery (the transport message), which the bus gives every handler and workflow of one delivery,
  // and a retry a new one. Not by the message, which a transport may hand out again on a retry, or which may be sent
  // more than once, so the retry would get the request-scoped state of the attempt that failed. Deliveries are
  // dropped once handled, which drops their scopes with them.
  const scopes = new WeakMap<object, ContextId>()

  const scopeFor = (context: ContainerContext | undefined): ContextId => {
    const delivery = context?.transportMessage
    const existing = delivery ? scopes.get(delivery) : undefined
    if (existing) {
      return existing
    }
    const contextId = ContextIdFactory.create()
    if (delivery) {
      scopes.set(delivery, contextId)
    }
    const message = context?.message
    if (typeof message === 'object' && message !== null) {
      moduleRef.registerRequestByContextId<BusRequest>(
        { message, attributes: context?.messageAttributes },
        contextId
      )
    }
    return contextId
  }

  return {
    get<T>(
      type: ClassConstructor<T>,
      context?: ContainerContext
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
      const resolved = moduleRef.resolve(type, scopeFor(context), {
        strict: false
      })
      if (context?.message !== undefined) {
        return resolved
      }
      // Only class workflows are resolved without a message, when the bus reads their configureWorkflow()
      return resolved.catch((error: unknown) => {
        throw new WorkflowResolvedWithoutMessage(type.name, error)
      })
    }
  }
}
