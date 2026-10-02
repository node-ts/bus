import { Bus } from '@node-ts/bus-core'
import { messageTypes } from './message-types.generated'

const bus = Bus.configure().withMessageTypes(messageTypes).build()

// Create the queues and subscriptions the bus needs, then start handling messages
await bus.initialize()
await bus.start()
