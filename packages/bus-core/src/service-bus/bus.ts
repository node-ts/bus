import { Event, Command, MessageAttributes, Message } from '@node-ts/bus-messages'
import { Middleware } from '../util'
import { TransportMessage } from '../transport'

export enum BusState {
  Stopped = 'stopped',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping'
}

export type HookAction = 'send' | 'publish' | 'error'

export type StandardHookCallback = (
  message: Message,
  messageAttributes?: MessageAttributes
) => Promise<void> | void

export type ErrorHookCallback<TransportMessageType> = (
  message: Message,
  error: Error,
  messageAttributes?: MessageAttributes,
  rawMessage?: TransportMessage<TransportMessageType>
) => Promise<void> | void

export type HookCallback<TransportMessageType> = StandardHookCallback | ErrorHookCallback<TransportMessageType>


export interface Bus {
  /**
   * Fetches the state of the message read and processing loop
   */
  state: BusState

  /**
   * The number of running parallel workers that are processing the application queue
   */
  runningParallelWorkerCount: number

  /**
   * Publishes an event onto the bus. Any subscribers of this event will receive a copy of it.
   */
  publish<EventType extends Event> (event: EventType, messageOptions?: MessageAttributes): Promise<void>

  /**
   * Sends a command onto the bus. There should be exactly one subscriber of this command type who can
   * process it and perform the requested action.
   */
  send<CommandType extends Command> (command: CommandType, messageOptions?: MessageAttributes): Promise<void>

  /**
   * Immediately fail the message of the current receive context and deliver it to the dead letter queue
   * (if configured). It will not be retried Any processing of the message by a different handler on the
   * same service instance will still process it.
   */
  fail (): Promise<void>

  /**
   * For applications that handle messages, start reading messages off the underlying queue and process them.
   */
  start (): Promise<void>

  /**
   * For  applications that handle messages, stop reading messages from the underlying queue.
   */
  stop (): Promise<void>

  /**
   * Registers a @param callback function that is invoked for every instance of @param action occurring
   * @template TransportMessageType - The raw message type returned from the transport that will be passed to the hooks
   */
  on<TransportMessageType = unknown> (action: HookAction, callback: HookCallback<TransportMessageType>): void

  /**
   * Deregisters a @param callback function from firing when an @param action occurs
   * @template TransportMessageType - The raw message type returned from the transport that will be passed to the hooks
   */
  off<TransportMessageType = unknown> (action: HookAction, callback: HookCallback<TransportMessageType>): void

  /**
   * Register optional middlewares that will run for each message that is polled from the transport
   * Note these middlewares only run when polling successfully pulls a message off the Transports queue
   * After all the user defined middlewares have registered. @see start and @see stop should add/remove a final bus middleware
   * that ensures the message is correctly dispatched to the handlers and removed from the underlying transport
   */
  useBeforeHandleNextMessage<TransportMessageType = unknown> (useBeforeHandleNextMessageMiddleware:  Middleware<TransportMessage<TransportMessageType>>): void
}
