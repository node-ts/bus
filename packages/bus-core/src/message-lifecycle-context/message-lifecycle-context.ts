import ALS from 'alscontext'

type Context = {
  /**
   * Flags that the application has requested that the current message be
   * returned to the queue for retry.
   */
  messageReturnedToQueue: boolean
}

/**
 * An internal context that tracks calls within handlers to .returnMessage()
 */
class MessageLifecycleContext extends ALS {
  /**
   * Fetch the message context for the current async stack
   */
  get(): Context {
    return super.get('message')
  }

  /**
   * Set the message context for the current async stack
   */
  set(message: Context) {
    return super.set('message', message)
  }

  /**
   * Start and run a new async context
   */
  run<T>(
    context: Context,
    fn: () => T | Promise<T>,
    isInHandlerContext = false
  ): T | Promise<T> {
    return super.run({ message: context, isInHandlerContext }, fn)
  }

  /**
   * Check if the call stack is within a handler or workflow handler context
   */
  get isInHandlerContext(): boolean {
    const isInHandlerContext = super.get('isInHandlerContext')
    return isInHandlerContext === true
  }
}

export const messageLifecycleContext = new MessageLifecycleContext()
