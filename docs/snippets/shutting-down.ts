import { Bus } from '@node-ts/bus-core'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

// #region dispose
const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(reserveRoomHandler)
  // Don't stop on signals, since the app handles them below
  .withInterruptSignals([])
  .build()

await bus.initialize()
await bus.start()

const shutDown = (signal: NodeJS.Signals) => {
  console.log(`Received ${signal}, shutting down...`)
  // Waits for the messages being handled, then disconnects from the transport
  // and persistence so the process can exit
  bus.dispose().catch(error => {
    console.error('Failed to shut down the bus', error)
    process.exitCode = 1
  })
}

process.once('SIGINT', shutDown)
process.once('SIGTERM', shutDown)
// #endregion dispose

// #region signals
// Also stop on SIGUSR2, as well as the default SIGINT and SIGTERM
Bus.configure().withInterruptSignals(['SIGINT', 'SIGTERM', 'SIGUSR2'])
// #endregion signals
