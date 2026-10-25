import { createBusConfiguration } from './bus-configuration.js'

const bus = createBusConfiguration()
  // The app stops the bus itself, below, so that it can dispose of it
  .withInterruptSignals([])
  .build()

// Checks the queues and tables exist (create them with `npm run provision`),
// then starts handling messages
await bus.initialize()
await bus.start()
console.log('The bus has started. Press Ctrl+C to stop it.')

const shutDown = (signal: NodeJS.Signals): void => {
  console.log(`Received ${signal}, stopping the bus...`)
  // Waits for the messages being handled, then disconnects from the transport
  // and persistence so that the process exits
  bus.dispose().catch((error: unknown) => {
    console.error('The bus could not be stopped cleanly', error)
    process.exitCode = 1
  })
}

process.once('SIGINT', shutDown)
process.once('SIGTERM', shutDown)
