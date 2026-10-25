import {
  Bus,
  BusConfiguration,
  ProvisionedResource,
  PruneIncomplete
} from '@node-ts/bus-core'
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

/**
 * Asks someone to approve what's about to be removed, such as a step of a deploy pipeline
 */
declare const approve: (resources: ProvisionedResource[]) => Promise<boolean>

const pruneFromCode = async () => {
  // #region prune
  const bus = busConfiguration().build()
  try {
    // Only reports what the bus no longer needs
    const found = (await bus.prune()).flatMap(plan => plan.resources)
    if (found.length && (await approve(found))) {
      // Removes only what was approved, even if more is found by now
      const [plan] = await bus.prune({ apply: true, only: found })
      console.log('Removed', plan?.removed, 'no longer found', plan?.notFound)
    }
  } catch (error) {
    if (error instanceof PruneIncomplete) {
      // Some of it couldn't be removed. What was removed stays removed.
      console.error(
        error.plans.map(({ removed, failed }) => ({ removed, failed }))
      )
    }
    throw error
  } finally {
    // prune() connects, but doesn't initialize or start the bus
    await bus.dispose()
  }
  // #endregion prune
}

const startWithoutVerification = async () => {
  // #region skip-verification
  // The service's credentials can't describe its resources, so don't check them
  const bus = busConfiguration().withResourceVerification(false).build()
  await bus.initialize()
  // #endregion skip-verification
}

export {
  provisionFromCode,
  pruneFromCode,
  start,
  startLocally,
  startWithoutVerification
}
