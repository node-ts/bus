import { Event, Command, MessageAttributes, Message } from '@node-ts/bus-messages'

export enum BusState {
  Stopped = 'stopped',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping'
}

export type HookAction = 'send' | 'publish'
export type HookCallback = (message: Message, messageAttributes?: MessageAttributes) => Promise<void> | void

export interface Bus {
  /**
   * Fetches the state of the message read and processing loop
   */
  state: BusState

  publish<EventType extends Event> (event: EventType, messageOptions?: MessageAttributes): Promise<void>
  send<CommandType extends Command> (command: CommandType, messageOptions?: MessageAttributes): Promise<void>

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
  on (action: HookAction, callback: HookCallback): void

  /**
   * Deregisters a @param callback function from firing when an @param action occurs
   */
  off (action: HookAction, callback: HookCallback): void
}
