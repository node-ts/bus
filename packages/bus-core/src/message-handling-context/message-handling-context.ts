import {
  createNamespace,
  destroyNamespace,
  getNamespace,
  Namespace
} from 'cls-hooked'
import { TransportMessage } from '../transport'

const NAMESPACE = 'message-handling-context'
let namespace: Namespace

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
   * Executes a function within a context of cls-hooked and returns the result
   */
  runAndReturn: <T>(fn: (...args: any[]) => T) => namespace.runAndReturn(fn),

  /**
   * Sets a new handling context for the current execution async id. Child asyncs should
   * only call this if they want to create a new context with themselves at the root.
   */
  set: (message: TransportMessage<unknown>) =>
    namespace?.set('message', message),
  /**
   * Fetches the message handling context of the active async stack
   */
  get: () => namespace?.get('message') as TransportMessage<unknown>,
  /**
   * Hooks into the async_hooks module to track the current execution context. Must be called before other operations.
   */
  enable: () => (namespace = createNamespace(NAMESPACE)),
  /**
   * Stops tracking the current execution context.
   */
  disable: () => {
    if (getNamespace(NAMESPACE)) {
      destroyNamespace(NAMESPACE)
    }
  }
}
