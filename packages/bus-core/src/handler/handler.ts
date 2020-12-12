import { Message, MessageAttributes } from '@node-ts/bus-messages'

export type Handler<TMessage extends Message = Message> = (message: TMessage, context: MessageAttributes) => void | Promise<void>
