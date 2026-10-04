import { AsyncLocalStorage } from 'node:async_hooks'
import { TransportMessage } from '../transport'

type Context = TransportMessage<unknown> & { isInHandlerContext?: boolean }

interface Store {
  message: Context
  /**
   * The message as the bus received it, which a workflow handler's copy of the context keeps
   */
  received: TransportMessage<unknown>
  isInHandlerContext: boolean
}

/**
 * A context that stores the transport message while a bus handles it, so calls in deeper stacks can read it.
 * Each bus has its own, so one bus never sees a message that another bus in the same process is handling.
 */
export class MessageHandlingContext {
  private readonly storage = new AsyncLocalStorage<Store>()

  /**
   * Fetch the message context for the current async stack
   * @returns The message being handled, or `undefined` outside of a message handling context
   */
  get(): Context {
    return this.storage.getStore()?.message as Context
  }

  /**
   * Fetch the transport message the bus received, which is handled in the current async stack. Unlike `get()`, it's
   * never a copy, such as the one a workflow handler runs in, so it can be compared by identity.
   * @returns The received message, or `undefined` outside of a message handling context
   */
  getReceived(): TransportMessage<unknown> | undefined {
    return this.storage.getStore()?.received
  }

  /**
   * Set the message context for the current async stack. Does nothing outside of a message handling context.
   * @param message The message to set as the context
   */
  set(message: Context): void {
    const store = this.storage.getStore()
    if (store) {
      store.message = message
    }
  }

  /**
   * Start and run a new async context
   * @param context The message to make available to the async stack of `fn`
   * @param fn The function to run within the new context
   * @param isInHandlerContext If the context is for a handler or workflow handler
   * @param received The message as the bus received it. By default, the received message of the enclosing context,
   * or `context` itself when there isn't one.
   * @returns The result of `fn`
   */
  run<T>(
    context: Context,
    fn: () => T | Promise<T>,
    isInHandlerContext = false,
    received: TransportMessage<unknown> = this.getReceived() ?? context
  ): T | Promise<T> {
    return this.storage.run(
      { message: context, received, isInHandlerContext },
      fn
    )
  }

  /**
   * Check if the call stack is within a handler or workflow handler context
   */
  get isInHandlerContext(): boolean {
    return this.storage.getStore()?.isInHandlerContext === true
  }
}
