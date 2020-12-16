import { Message, MessageAttributes } from '@node-ts/bus-messages'

export interface HandlerParameters<TMessage extends Message> {
  message: TMessage
  context: MessageAttributes
}

export type Handler<TMessage extends Message = Message> = (parameters: HandlerParameters<TMessage>) => void | Promise<void>
