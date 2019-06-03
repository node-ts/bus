import { Message } from '@node-ts/bus-messages'
import { MessageAttributes } from '../service-bus'

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
  domainMessage: Message

  /**
   * The raw message as it was received from the transprot
   */
  raw: TransportMessageType

  /**
   * Additional attributes and metadata that was sent along with the message
   */
  options: MessageAttributes
}
