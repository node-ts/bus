import { Message, MessageAttributes } from '@node-ts/bus-messages'

export interface HandlerContext<TMessage extends Message> extends MessageAttributes {
  message: TMessage
}

export type Handler<TMessage extends Message = Message> = (context: HandlerContext<TMessage>) => void | Promise<void>
