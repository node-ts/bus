import { HandlerPrototype } from './handler'
import { ClassConstructor } from '../util'
import { RawHandler } from './raw-handler'

export type RawMessageResolver<TMessage> = (message: TMessage) => boolean

/**
 * Marks that the decorated class handles a raw message that originates from an external system and
 * does not conform to the `@node-ts/bus-messages/message` domain type.
 *
 * A custom resolver must be provided so the system can determine if a received message should
 * be dispatched to the handler.
 *
 */
export function HandlesRawMessage<
  TMessage,
  THandler extends RawHandler<TMessage>,
  HandlerConstructor extends ClassConstructor<THandler>
> (
  resolver: RawMessageResolver<TMessage>
): (handlerConstructor: HandlerConstructor) => void {

  return (handlerConstructor: HandlerConstructor) => {
    const prototype = handlerConstructor.prototype as HandlerPrototype
    prototype.$symbol = Symbol.for(`node-ts/bus-core/handles-message/${handlerConstructor.name}`)
  }
}
