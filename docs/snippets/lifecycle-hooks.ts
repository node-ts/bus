import { Bus } from '@node-ts/bus-core'
import { messageTypes } from './message-types.generated'

const bus = Bus.configure().withMessageTypes(messageTypes).build()

// #region on
const unsubscribe = bus.onError.on(({ message, error, attributes }) =>
  console.error('Failed to handle message', {
    messageName: message.$name,
    correlationId: attributes?.correlationId,
    error
  })
)

// Later, to stop listening
unsubscribe()
// #endregion on

// #region hooks
bus.beforeSend.on(({ command, attributes }) =>
  console.debug('Sending', command.$name, attributes)
)
bus.afterSend.on(({ command }) => console.debug('Sent', command.$name))
bus.beforePublish.on(({ event, attributes }) =>
  console.debug('Publishing', event.$name, attributes)
)
bus.afterPublish.on(({ event }) => console.debug('Published', event.$name))
bus.afterReceive.on(({ message }) => console.debug('Received', message.id))
bus.beforeDispatch.on(({ message, handlers }) =>
  console.debug('Dispatching', message.$name, handlers.length)
)
bus.afterDispatch.on(({ message }) => console.debug('Handled', message.$name))
bus.onError.on(({ message, error, rawMessage }) =>
  console.debug('Failed', message.$name, rawMessage?.id, error)
)
// #endregion hooks
