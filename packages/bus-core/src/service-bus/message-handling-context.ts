import { TransportMessage } from '../transport'
import { Message } from '@node-ts/bus-messages'

/**
 * A context that exists from when a message is received from the transport
 * and until it is deleted from or returned back to the transport
 */
export interface MessageHandlingContext<TMessageType extends Message> {
  /**
   * The raw message that was received from the transport
   */
  rawMessage: TransportMessage<TMessageType>
}
