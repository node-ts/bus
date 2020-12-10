import { configureSqsTransport } from '@node-ts/sqs-transport'
import { configureWinstonLogger } from '@node-ts/winson-logger'
import { testCommandHandler } from './test-command-handler'
import { TestCommand } from './test-command'

import { TestEventHandler } from './test-event-handler'
import { TestEvent } from './test-event'
import { configurePostgresPersistence } from '@node-ts/postgres-persistence'

import { Workflow } from '@node-ts/bus-workflow'
import { Bus } from './bus'

const sqsTransport = configureSqsTransport({})
const winstonLogger = configureWinstonLogger()

const run = async () => {
  await Bus
    .configure()
    .withTransport(sqsTransport)
    .withLogger(winstonLogger)
    .withSerializer({})
    .withHandler(TestCommand, testCommandHandler) // Function handler
    .withHandler(TestEvent, TestEventHandler) // Class handler, must adhere to interface
    .initialize()

  await Bus.start()
  await Bus.send(new TestCommand())

  // const postgresPersistence = configurePostgresPersistence({})

  // await Workflow
  //   .withPersistence(postgresPersistence)
  //   .withWorkflow(assignmentWorkflow)
  //   .initialize(bus)


  await Bus.stop()
}

run().catch(() => {})
