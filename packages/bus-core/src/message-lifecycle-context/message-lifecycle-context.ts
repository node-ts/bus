import { AsyncLocalStorage } from 'node:async_hooks'

type Context = {
  /**
   * Flags that the application has requested that the current message be
   * returned to the queue for retry.
   */
  messageReturnedToQueue: boolean

  /**
   * Flags that the application has requested that the current message be
   * moved to the dead letter queue without retrying.
   */
  messageFailed: boolean
}

interface Store {
  message: Context
}

/**
 * An internal context that tracks calls within handlers to .returnMessage() and .failMessage(). Each bus has its
 * own. The bus settles the message once handling finishes, so each message is deleted, returned or dead-lettered
 * exactly once.
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
   * Reads the lifecycle context of the message being handled now, even when it's called later from elsewhere. The
   * context is replaced on each `set()`, so the reader sees every change made while handling that message.
   * @returns a function that returns that message's lifecycle context, or `undefined` if no message is being handled
   */
  bindToCurrent(): () => Context | undefined {
    const store = this.storage.getStore()
    return () => store?.message
  }

  /**
   * Whether the message being handled in the current async stack has been failed with `failMessage()` or returned
   * with `returnMessage()`
   * @returns true if either was called, or false outside of a message lifecycle context
   */
  isFailedOrReturned(): boolean {
    const context = this.storage.getStore()?.message
    return (
      !!context && (context.messageFailed || context.messageReturnedToQueue)
    )
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
