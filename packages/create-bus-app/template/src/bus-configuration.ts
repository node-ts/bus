import './env.js'

import { Bus, BusConfiguration } from '@node-ts/bus-core'
import { lendBookHandler } from './lend-book-handler.js'
import { loanWorkflow } from './loan-workflow.js'
import { messageTypes } from './message-types.generated.js'
import { createPersistence } from './persistence.js'
import { createTransport } from './transport.js'

/**
 * The name of the app's queue
 */
export const QUEUE_NAME = process.env.QUEUE_NAME ?? 'create-bus-app-template'

export interface BusConfigurationOptions {
  /**
   * The queue to receive from
   * @default QUEUE_NAME
   */
  queueName?: string
}

/**
 * Configures the app's bus. `npm run provision` (`bus provision`) builds it to
 * create the queues and tables it needs, and src/index.ts builds it to run it.
 */
export const createBusConfiguration = ({
  queueName = QUEUE_NAME
}: BusConfigurationOptions = {}): BusConfiguration =>
  Bus.configure()
    .withTransport(createTransport(queueName))
    .withPersistence(createPersistence())
    // Restores the Dates and classes in the messages and workflow state the bus receives
    .withMessageTypes(messageTypes)
    .withHandler(lendBookHandler)
    .withWorkflow(loanWorkflow)
    // Saves workflow state and what handlers send in one transaction, and
    // skips messages that were already handled
    .withOutbox()

export default createBusConfiguration
