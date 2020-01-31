import { Message } from '@node-ts/bus-messages'
import { HandlerPrototype, Handler } from './handler'
import { ClassConstructor } from '../util'

type M = {} | Message

/**
 * Marks that the decorated class handles a particular message. When a message
 * matching the given type is received from the underlying transport it will be dispatched
 * to this function.
 *
 * The dispatcher will dispatch received messsages to the `handle()` function of your class.
 *
 * @param messageConstructor The type of message that the function handles
 * @param customResolver A custom resolver to use to map messages to the handler. This can be used to handle
 * messages that originate in a different system or that don't conform to the `Message` conventions.
 */
export function HandlesMessage<
  TMessage extends M,
  THandler extends Handler<TMessage>,
  HandlerConstructor extends ClassConstructor<THandler>
> (
  messageConstructor: ClassConstructor<TMessage>,
  customResolver?: (message: TMessage) => boolean
): (handlerConstructor: HandlerConstructor) => void {
  const message = new messageConstructor()

  return (handlerConstructor: HandlerConstructor) => {
    const prototype = handlerConstructor.prototype as HandlerPrototype<TMessage>
    prototype.$message = messageConstructor
    prototype.$symbol = Symbol.for(`node-ts/bus-core/handles-message/${handlerConstructor.name}`)

    if (customResolver) {
      prototype.$resolver = customResolver
    } else if (message instanceof Message) {
      const busMessage = message as Message
      prototype.$resolver = m => (m as Message).$name === busMessage.$name
    } else {
      throw new Error(
        'Message handler will not resolve. Please supply either a bus based `Message` or a custom resolver.'
      )
    }
  }
}
