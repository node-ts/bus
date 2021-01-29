import { Event, Command, MessageAttributes, Message } from '@node-ts/bus-messages'
import { TransportMessage } from '../transport'

export enum BusState {
  Stopped = 'stopped',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping'
}

export type HookAction = 'send' | 'publish' | 'error'

export type StandardHookCallback = (
  message: Message, messageAttributes?: MessageAttributes
) => Promise<void> | void

export type ErrorHookCallback<T> = (
  message: Message, error: Error,
  messageAttributes?: MessageAttributes,
  rawMessage?: TransportMessage<T>
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
   * Registers a @param callback function that is invoked for every instance of @param action occuring
   */
  on<T> (action: HookAction, callback: HookCallback<T>): void

  /**
   * Deregisters a @param callback function from firing when an @param action occurs
   */
  off<T> (action: HookAction, callback: HookCallback<T>): void
}
