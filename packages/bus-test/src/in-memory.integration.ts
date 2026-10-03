import { InMemoryPersistence } from '@node-ts/bus-core'
import { TransportTestInMemoryQueue } from './test/transport-test-in-memory-queue'
import { transportTests } from './transport-tests'
import { workflowStateRoundTripTests } from './workflow-state-round-trip-tests'

describe('InMemoryQueue', () => {
  const queue = new TransportTestInMemoryQueue()
  transportTests(
    queue,
    queue.publishSystemMessage,
    undefined,
    queue.readAllFromDeadLetterQueue
  )
})

describe('InMemoryPersistence', () => {
  workflowStateRoundTripTests(new InMemoryPersistence())
})
