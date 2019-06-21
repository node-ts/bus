import { Event, Command, MessageAttributes } from '@node-ts/bus-messages'

export enum BusState {
  Stopped = 'stopped',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping'
}

export interface Bus {
  publish<EventType extends Event> (event: EventType, messageOptions?: MessageAttributes): Promise<void>
  send<CommandType extends Command> (command: CommandType, messageOptions?: MessageAttributes): Promise<void>
  start (): Promise<void>
  stop (): Promise<void>
}
