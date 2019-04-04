import { Event, Command } from '@node-ts/bus-messages'
import { TransportMessage } from './transport-message'
import { HandlerRegistry } from '../handler'

export interface Transport<TransportMessageType = {}> {
  publish<TEvent extends Event> (event: TEvent): Promise<void>
  send<TCommand extends Command> (command: TCommand): Promise<void>
  readNextMessage (): Promise<TransportMessage<TransportMessageType> | undefined>
  deleteMessage (message: TransportMessage<TransportMessageType>): Promise<void>
  returnMessage (message: TransportMessage<TransportMessageType>): Promise<void>
  initialize? (handlerRegistry: HandlerRegistry): Promise<void>
  dispose? (): Promise<void>
}
