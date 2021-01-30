import * as asyncHooks from 'async_hooks'
import { TransportMessage } from '../transport'

const handlingContexts = new Map<number, TransportMessage<unknown>>()

const init = (asyncId: number, _: string, triggerAsyncId: number) => {
  if (handlingContexts.has(triggerAsyncId)) {
    handlingContexts.set(asyncId, handlingContexts.get(triggerAsyncId)!)
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
 * a message handling operation across multiple nested promises/callbacks.
 *
 * It's primarily used to allow Bus.send/Bus.publish to propagate sticky attributes
 * and correlation ids.
 */
export const messageHandlingContext = {
  set: (message: TransportMessage<unknown>) => {
    handlingContexts.set(asyncHooks.executionAsyncId(), message)
  },
  get: () => handlingContexts.get(asyncHooks.executionAsyncId()),
  destroy: () => {
    if (handlingContexts.has(asyncHooks.executionAsyncId())) {
      handlingContexts.delete(asyncHooks.executionAsyncId())
    }
  },
  enable: () => hooks.enable(),
  disable: () => hooks.disable()
}
