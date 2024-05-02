import { TransportMessage } from '../transport'
import ALS from 'alscontext'

type Context = TransportMessage<unknown> & { isInHandlerContext?: boolean }

/**
 * A context that stores the transport message when it is received from the bus. Any calls in deeper stacks can
 * access the context by calling `messageHandlingContext.get()`.
 */
class MessageHandlingContext extends ALS {
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

export const messageHandlingContext = new MessageHandlingContext()
