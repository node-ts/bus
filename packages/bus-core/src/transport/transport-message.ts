import { MessageAttributes } from '@node-ts/bus-messages'
import { MessageType } from '../handler/handler'

/**
 * A message from the transport provider that encapsulates the raw message
 * plus the domain message payload
 */
export interface TransportMessage<TransportMessageType> {
  /**
   * Uniquely identify the message
   */
  id: string | undefined

  /**
   * The domain message payload transmitted in the payload
   */
  domainMessage: MessageType

  /**
   * The raw message as it was received from the transport
   */
  raw: TransportMessageType

  /**
   * Additional attributes and metadata that was sent along with the message
   */
  attributes: MessageAttributes
}
