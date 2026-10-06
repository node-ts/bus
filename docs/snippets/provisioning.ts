import { Bus, BusConfiguration } from '@node-ts/bus-core'
import { PostgresPersistence } from '@node-ts/bus-postgres'
import { SqsTransport } from '@node-ts/bus-sqs'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

// #region module
// src/bus-configuration.ts: the bus the service runs, and what `bus provision` provisions
export const busConfiguration = (): BusConfiguration =>
  Bus.configure()
    .withMessageTypes(messageTypes)
    .withTransport(
      new SqsTransport({
        awsRegion: process.env.AWS_REGION,
        awsAccountId: process.env.AWS_ACCOUNT_ID,
        queueName: 'reservations-service'
      })
    )
    .withPersistence(
      new PostgresPersistence({
        connection: { connectionString: process.env.DATABASE_URL },
        schemaName: 'workflows'
      })
    )
    .withHandler(reserveRoomHandler)
    .withWorkflow(fulfilmentWorkflow)
// #endregion module

const start = async () => {
  // #region start
  // src/main.ts: creates nothing, and fails fast if anything the bus needs is missing
  const bus = busConfiguration().build()
  await bus.initialize()
  await bus.start()
  // #endregion start
}

const startLocally = async () => {
  // #region auto-provision
  // Local development and tests: create everything when the bus initializes
  const bus = busConfiguration().withAutoProvision().build()
  await bus.initialize()
  // #endregion auto-provision
}

const provisionFromCode = async () => {
  // #region provision
  const bus = busConfiguration().build()
  try {
    // Returns what each transport and persistence provisioned
    const plans = await bus.provision()
    console.log(plans.map(plan => plan.adapter))
  } finally {
    // provision() connects, but doesn't initialize or start the bus
    await bus.dispose()
  }
  // #endregion provision
}

const startWithoutVerification = async () => {
  // #region skip-verification
  // The service's credentials can't describe its resources, so don't check them
  const bus = busConfiguration().withResourceVerification(false).build()
  await bus.initialize()
  // #endregion skip-verification
}

export { provisionFromCode, start, startLocally, startWithoutVerification }
