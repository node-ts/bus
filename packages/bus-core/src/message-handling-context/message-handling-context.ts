import * as asyncHooks from 'async_hooks'
import { TransportMessage } from '../transport'

interface HandlingContext {
  /**
   * A list of child async process ids that are running in the same execution context
   * and need to be destroyed when the parent is destroyed.
   *
   * This can be handled with regular destroy hooks, however this is subject to GC
   * and runs the risk of keeping a large number of contexts open after their parent
   * context has closed.
   */
  childAsyncIds: number[]
  message: TransportMessage<unknown>
}

const handlingContexts = new Map<number, HandlingContext>()

const init = (asyncId: number, _: string, triggerAsyncId: number) => {
  // Ensures that child promises inherit the same context as their parent
  if (handlingContexts.has(triggerAsyncId)) {
    const context = handlingContexts.get(triggerAsyncId)!
    context.childAsyncIds.push(asyncId)
    handlingContexts.set(asyncId, context)
  }
}

const destroy = (asyncId: number) => {
  if (handlingContexts.has(asyncId)) {
    handlingContexts.delete(asyncId)
  }
}

const hooks = asyncHooks.createHook({
  init,
  destroy
})

/**
 * This is an internal coordinator that tracks the execution context for
 * a message handling operation across multiple nested promises/callbacks as a way
 * of providing a type of thread local storage (TLS).
 *
 * It's primarily used to allow Bus.send/Bus.publish to propagate sticky attributes
 * and correlation ids in parallel handling contexts.
 */
export const messageHandlingContext = {
  /**
   * Sets a new handling context for the current execution async id. Child asyncs should
   * only call this if they want to create a new context with themselves at the root.
   */
  set: (message: TransportMessage<unknown>) =>
    handlingContexts.set(
      asyncHooks.executionAsyncId(),
      {
        childAsyncIds: [],
        message
      }
    ),
  get: () => handlingContexts.get(asyncHooks.executionAsyncId()),
  destroy: () => {
    const asyncId = asyncHooks.executionAsyncId()
    const context = handlingContexts.get(asyncId)
    if (!context) {
      return
    }

    context.childAsyncIds.forEach(childAsyncId => handlingContexts.delete(childAsyncId))
    handlingContexts.delete(asyncId)
  },
  enable: () => hooks.enable(),
  disable: () => hooks.disable()
}
