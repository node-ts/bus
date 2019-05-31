import { Event, Command } from '@node-ts/bus-messages'
import { MessageOptions } from './message-options'

export enum BusState {
  Stopped = 'stopped',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping'
}

export interface Bus {
  publish<EventType extends Event> (event: EventType, messageOptions?: MessageOptions): Promise<void>
  send<CommandType extends Command> (command: CommandType, messageOptions?: MessageOptions): Promise<void>
  start (): Promise<void>
  stop (): Promise<void>
}
