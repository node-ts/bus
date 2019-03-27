import { Event, Command, Message } from '@node-ts/bus-messages'

export interface Transport {
  publish<TEvent extends Event> (event: TEvent): Promise<void>
  send<TCommand extends Command> (command: TCommand): Promise<void>
  readNextMessage (): Promise<Message | undefined>
  deleteMessage (message: Message): Promise<void>
  returnMessage (message: Message): Promise<void>
}
