import { Message } from '@node-ts/bus-messages'
import { HandlerPrototype, Handler } from './handler'
import { ClassConstructor } from '../util'

/**
 * Marks that the decorated class handles a particular message. When a message
 * matching the given type is received from the underlying transport it will be dispatched
 * to this function.
 *
 * The dispatcher will dispatch received messsages to the `handle()` function of your class.
 *
 * @param messageConstructor The type of message that the function handles
 */
export function HandlesMessage<
  TMessage extends Message,
  THandler extends Handler<TMessage>,
  HandlerConstructor extends ClassConstructor<THandler>
> (
  messageConstructor: ClassConstructor<TMessage>
): (handlerConstructor: HandlerConstructor) => void {
  const message = new messageConstructor()

  return (handlerConstructor: HandlerConstructor) => {
    const prototype = handlerConstructor.prototype as HandlerPrototype
    prototype.$messageName = message.$name
    prototype.$message = messageConstructor
    prototype.$symbol = Symbol()
  }
}
