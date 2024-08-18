import { MessageSerializer } from '../serialization'

/**
 * When used, the app will be responsible for receiving its own messages rather than subscribing directly
 * to the transport. This can be useful for local testing or in serverless environments, where the cloud
 * will manage receiving a message from the transport and passing it directly to the serverless container.
 */
export interface Receiver<TReceivedMessage, TTransportMessage> {
  /**
   * Invoked when a message is received by the application and needs to be converted into a transport message
   * so that it can be passed to the dispatcher and send to handlers.
   *
   * @param receivedMessage The message received by the app
   * @param messageSerializer The configured serializer, which can be used to deserialize the incoming message
   */
  receive(
    receivedMessage: TReceivedMessage,
    messageSerializer: MessageSerializer
  ): Promise<TTransportMessage | TTransportMessage[]>
}
