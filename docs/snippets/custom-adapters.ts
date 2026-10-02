import { Bus } from '@node-ts/bus-core'
import { messageTypes } from './message-types.generated'
import { documentStore } from './persistence/document-store'
import { MyPersistence } from './persistence/my-persistence'
import { brokerClient } from './transports/broker-client'
import { MyTransport } from './transports/my-transport'

// #region transport
const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(
    new MyTransport(
      {
        queueName: 'reservations-service',
        connectionString: 'broker://localhost'
      },
      brokerClient
    )
  )
  .build()
// #endregion transport

// #region persistence
Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(new MyPersistence(documentStore))
// #endregion persistence

await bus.initialize()
