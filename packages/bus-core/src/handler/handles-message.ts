import { Message } from '@node-ts/bus-messages'
import { HandlerPrototype, Handler, MessageType } from './handler'
import { ClassConstructor, isClassConstructor } from '../util'

/**
 * Marks that the decorated class handles a particular message. When a message
 * matching the given type is received from the underlying transport it will be dispatched
 * to this function.
 *
 * The dispatcher will dispatch received messages to the `handle()` function of your class.
 *
 * @param messageConstructor The type of message that the function handles
 * @param customResolver A custom resolver to use to map messages to the handler. This can be used to handle
 * messages that originate in a different system or that don't conform to the `Message` conventions.
 */
export function HandlesMessage<
  TMessage extends MessageType,
  THandler extends Handler<TMessage>,
  HandlerConstructor extends ClassConstructor<THandler>
> (
  resolveWith: ClassConstructor<TMessage> | ((message: TMessage) => boolean)
  ): (handlerConstructor: HandlerConstructor) => void {
    return (handlerConstructor: HandlerConstructor) => {
    const prototype = handlerConstructor.prototype as HandlerPrototype<TMessage>
    prototype.$symbol = Symbol.for(`node-ts/bus-core/handles-message/${handlerConstructor.name}`)

    const isBusMessage = isClassConstructor(resolveWith)

    if (isBusMessage) {
      const messageConstructor = resolveWith as ClassConstructor<TMessage>
      const message = new messageConstructor()
      const busMessage = message as Message
      prototype.$message = messageConstructor
      prototype.$resolver = m => (m as Message).$name === busMessage.$name
    } else if (resolveWith instanceof Function) {
      prototype.$resolver = resolveWith as ((message: TMessage) => boolean)
    } else {
      throw new Error(
        'Message handler will not resolve. Please supply either a bus based `Message` or a custom resolver.'
      )
    }
  }
}
