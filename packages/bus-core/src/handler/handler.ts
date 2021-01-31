import { Message, MessageAttributes } from '@node-ts/bus-messages'

export interface HandlerContext<TMessage extends Message> {
  message: TMessage
  attributes: MessageAttributes
}

export type Handler<TMessage extends Message = Message> = (context: HandlerContext<TMessage>) => void | Promise<void>
