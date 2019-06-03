import { Event, Command } from '@node-ts/bus-messages'
import { MessageAttributes } from './message-attributes'

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
