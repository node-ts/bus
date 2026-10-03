import { InMemoryPersistence } from '@node-ts/bus-core'
import { scheduledMessageRoundTripTests } from './scheduled-message-round-trip-tests'
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
  scheduledMessageRoundTripTests(new InMemoryPersistence())
})
