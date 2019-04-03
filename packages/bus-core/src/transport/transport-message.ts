import { Message } from '@node-ts/bus-messages'

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
}
