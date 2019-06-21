import { Event, Command, MessageAttributes } from '@node-ts/bus-messages'
import { TransportMessage } from './transport-message'
import { HandlerRegistry } from '../handler'

/**
 * A transport adapter interface that enables the service bus to use a messaging technology.
 */
export interface Transport<TransportMessageType = {}> {
  /**
   * Publishes an event to the underlying transport. This is generally done to a topic or some other
   * mechanism that consumers can subscribe themselves to
   * @param event A domain event to be published
   * @param messageOptions Options that control the behaviour around how the message is sent and
   * additional information that travels with it.
   */
  publish<TEvent extends Event> (event: TEvent, messageOptions: MessageAttributes): Promise<void>

  /**
   * Sends a command to the underlying transport. This is generally done to a topic or some other
   * mechanism that consumers can subscribe themselves to
   * @param command A domain command to be sent
   * @param messageOptions Options that control the behaviour around how the message is sent and
   * additional information that travels with it.
   */
  send<TCommand extends Command> (command: TCommand, messageOptions: MessageAttributes): Promise<void>

  /**
   * Fetch the next message from the underlying queue. If there are no messages, then `undefined`
   * should be returned.
   *
   * @returns The message construct from the underlying transport, that inclues both the raw message envelope
   * plus the contents or body that contains the `@node-ts/bus-messages` message.
   */
  readNextMessage (): Promise<TransportMessage<TransportMessageType> | undefined>

  /**
   * Removes a message from the underlying transport. This will be called once a message has been
   * successfully handled by any of the message handling functions.
   * @param message The message to be removed from the transport
   */
  deleteMessage (message: TransportMessage<TransportMessageType>): Promise<void>

  /**
   * Returns a message to the queue for retry. This will be called if an error was thrown when
   * trying to process a message.
   * @param message The message to be returned to the queue for reprocessing
   */
  returnMessage (message: TransportMessage<TransportMessageType>): Promise<void>

  /**
   * An optional function that will be called when the service bus is starting. This is an
   * opportunity for the transport to see what messages need to be handled so that subscriptions
   * to the topics can be created.
   * @param handlerRegistry The list of messages being handled by the bus that the transport needs to subscribe to.
   */
  initialize? (handlerRegistry: HandlerRegistry): Promise<void>

  /**
   * An optional function that will be called when the service bus is shutting down. This is an
   * opportunity for the transport to close out any open requests to fetch messages etc.
   */
  dispose? (): Promise<void>
}
