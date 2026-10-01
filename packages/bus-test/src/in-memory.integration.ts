import { InMemoryPersistence } from '@node-ts/bus-core'
import { messageRoundTripTests } from './message-round-trip-tests'
import { SerializingInMemoryQueue } from './test/serializing-in-memory-queue'
import { workflowStateRoundTripTests } from './workflow-state-round-trip-tests'

describe('InMemoryQueue', () => {
  messageRoundTripTests(new SerializingInMemoryQueue())
})

describe('InMemoryPersistence', () => {
  workflowStateRoundTripTests(new InMemoryPersistence())
})
