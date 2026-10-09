import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { TransportMessage } from '../transport'

/**
 * What the bus passes to `ContainerAdapter.get` when it resolves a class handler or workflow to handle a message,
 * so a container can resolve differently for each message, such as in a request scope of its own.
 */
export interface ContainerContext {
  /**
   * The message being handled
   */
  message?: Message

  /**
   * The attributes of the message being handled
   */
  messageAttributes?: MessageAttributes

  /**
   * The delivery of the message being handled, as it was read from the transport or given to a `Receiver`. It's a
   * new object for each delivery, including each retry of the same message, and the same object for every class
   * handler and workflow that handles that delivery. Key a scope per message on it rather than on `message`, which a
   * transport may hand out again on a retry, or which may be sent more than once, so a retry gets a fresh scope
   * instead of the state of the attempt that failed.
   */
  transportMessage?: TransportMessage<unknown>
}
