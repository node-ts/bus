/// <reference types="jest" />
// #region suite
import { workflowStateRoundTripTests } from '@node-ts/bus-test'
import { documentStore } from './document-store'
import { MyPersistence } from './my-persistence'

jest.setTimeout(30_000)

describe('MyPersistence', () => {
  // The suite disposes the persistence when it's done, so give it its own
  workflowStateRoundTripTests(new MyPersistence(documentStore))
})
// #endregion suite
