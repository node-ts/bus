import { Bus, BusInstance } from '../service-bus'
import { sleep } from '../util'
import { InMemoryPersistence } from './persistence'
import { TestCommand } from './test'
import {
  TestDiscardedWorkflow,
  TestDiscardedWorkflowState
} from './test/test-discarded-workflow'
import { It, Mock, Times } from 'typemoq'
import {
  TestVoidStartedByWorkflow,
  TestVoidStartedByWorkflowState
} from './test/test-void-startedby-workflow'

describe('Workflow Started By', () => {
  const inMemoryPersistence = Mock.ofType<InMemoryPersistence>()
  let bus: BusInstance

  beforeAll(async () => {
    bus = Bus.configure()
      .withPersistence(inMemoryPersistence.object)
      .withWorkflow(TestDiscardedWorkflow)
      .withWorkflow(TestVoidStartedByWorkflow)
      .build()

    await bus.initialize()
    await bus.start()
  })

  afterAll(async () => {
    bus.dispose()
  })

  describe('when a workflow that discards during startedBy is executed', () => {
    beforeEach(async () => {
      inMemoryPersistence.reset()
      await bus.send(new TestCommand('abc'))
      await sleep(2_000)
    })

    it('should not persist any workflow state', async () => {
      inMemoryPersistence.verify(
        p =>
          p.saveWorkflowState(
            It.isObjectWith<any>({
              $name: TestDiscardedWorkflowState.NAME
            })
          ),
        Times.never()
      )
    })
  })

  describe('when a workflow that returns void during startedBy is executed', () => {
    beforeEach(async () => {
      inMemoryPersistence.reset()
      await bus.send(new TestCommand('abc'))
      await sleep(2_000)
    })

    it('should persist workflow state', async () => {
      inMemoryPersistence.verify(
        p =>
          p.saveWorkflowState(
            It.isObjectWith<any>({
              $name: TestVoidStartedByWorkflowState.NAME
            })
          ),
        Times.once()
      )
    })
  })
})
