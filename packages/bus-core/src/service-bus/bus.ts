import { Event, Command } from '@node-ts/bus-messages'

export enum BusState {
  Stopped = 'stopped',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping'
}

export interface Bus {
  publish<EventType extends Event> (event: EventType): Promise<void>
  send<CommandType extends Command> (command: CommandType): Promise<void>
  start (): Promise<void>
  stop (): Promise<void>
}
