import { AsyncLocalStorage } from 'node:async_hooks'

type Context = {
  /**
   * Flags that the application has requested that the current message be
   * returned to the queue for retry.
   */
  messageReturnedToQueue: boolean
}

interface Store {
  message: Context
}

/**
 * An internal context that tracks calls within handlers to .returnMessage(). Each bus has its own.
 */
export class MessageLifecycleContext {
  private readonly storage = new AsyncLocalStorage<Store>()

  /**
   * Fetch the message context for the current async stack
   * @returns The lifecycle context, or `undefined` outside of a message lifecycle context
   */
  get(): Context {
    return this.storage.getStore()?.message as Context
  }

  /**
   * Set the message context for the current async stack. Does nothing outside of a message lifecycle context.
   * @param message The lifecycle context to set
   */
  set(message: Context): void {
    const store = this.storage.getStore()
    if (store) {
      store.message = message
    }
  }

  /**
   * Start and run a new async context
   * @param context The lifecycle context to make available to the async stack of `fn`
   * @param fn The function to run within the new context
   * @returns The result of `fn`
   */
  run<T>(context: Context, fn: () => T | Promise<T>): T | Promise<T> {
    return this.storage.run({ message: context }, fn)
  }
}
