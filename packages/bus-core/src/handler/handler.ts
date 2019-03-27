import { Message } from '@node-ts/bus-messages'
import { ClassConstructor } from '@node-ts/logger-core'

export interface HandlerPrototype {
  $messageName: string
  $message: ClassConstructor<Message>
  $symbol: symbol
}

/**
 * An interface used by `HandlesMessages` used to dispatch messages to
 */
export interface Handler<TMessage extends Message> {
  handle (message: TMessage): Promise<void> | void
}
