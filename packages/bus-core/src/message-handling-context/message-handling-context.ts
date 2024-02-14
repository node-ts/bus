import { TransportMessage } from '../transport'
import ALS from 'alscontext'

class MessageHandlingContext extends ALS {
  /**
   * Fetch the message context for the current async stack
   */
  get(): TransportMessage<unknown> {
    return super.get('message')
  }

  /**
   * Set the message context for the current async stack
   */
  set(message: TransportMessage<unknown>) {
    return super.set('message', message)
  }

  /**
   * Start and run a new async context
   */
  run<T>(context: TransportMessage<unknown>, fn: () => T | Promise<T>) {
    return super.run({ message: context }, fn)
  }
}

export const messageHandlingContext = new MessageHandlingContext()
