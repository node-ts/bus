/// <reference types="jest" />
// #region suite
import {
  outboxTests,
  scheduledMessageRoundTripTests,
  workflowStateRoundTripTests
} from '@node-ts/bus-test'
import { documentStore } from './document-store'
import { MyPersistence } from './my-persistence'

jest.setTimeout(30_000)

describe('MyPersistence', () => {
  // Each suite disposes its persistence when it's done, so give each its own
  workflowStateRoundTripTests(new MyPersistence(documentStore))
  // Only if MyPersistence stores outgoing messages, ideally on a database of its own
  scheduledMessageRoundTripTests(new MyPersistence(documentStore))
  // Only if MyPersistence implements beginTransaction(), for withOutbox()
  outboxTests(new MyPersistence(documentStore))
})
// #endregion suite
