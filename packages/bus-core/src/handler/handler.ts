import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { ClassConstructor } from '../util'

export interface HandlerContext<TMessage extends Message> {
  message: TMessage
  attributes: MessageAttributes
}

export interface ClassHandler<TMessage extends Message = Message> {
  handle (context: HandlerContext<TMessage>): void | Promise<void>
}

export type FunctionHandler<TMessage extends Message> = (context: HandlerContext<TMessage>) => void | Promise<void>

export type Handler<TMessage extends Message = Message> =
  FunctionHandler<TMessage>
  | ClassConstructor<ClassHandler<TMessage>>

/**
 * A naive but best guess effort into if a handler is class based and should be resolved from a container
 */
export const isClassHandler = (handler: Handler) => handler.prototype?.handle && handler.prototype?.constructor?.name
