import { EventEmitter } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { Bus, BusInstance } from '../service-bus'
import { sleep } from '../util'
import { InMemoryPersistence } from './persistence'
import { TestCommand } from './test'
import {
  TestDiscardedWorkflow,
  TestDiscardedWorkflowState
} from './test/test-discarded-workflow'
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
    await bus.dispose()
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

  describe('when a startedBy message is retried after the workflow state was saved', () => {
    const persistence = new InMemoryPersistence()
    const workflowRegistryLogger = Mock.ofType<Logger>()
    const events = new EventEmitter()
    let retriedBus: BusInstance

    beforeAll(async () => {
      let attempts = 0
      // A second handler of the same message fails its first attempt, so the message is retried
      const failOnceHandler = handlerFor(TestCommand, async () => {
        if (++attempts === 1) {
          throw new Error('Fail the first attempt')
        }
      })

      retriedBus = Bus.configure()
        .withLogger(target =>
          target === '@node-ts/bus-core:workflow-registry'
            ? workflowRegistryLogger.object
            : Mock.ofType<Logger>().object
        )
        .withPersistence(persistence)
        .withWorkflow(TestVoidStartedByWorkflow)
        .withHandler(failOnceHandler)
        .build()

      retriedBus.afterDispatch.on(() => events.emit('received'))
      await retriedBus.initialize()
      await retriedBus.start()

      const received = new Promise(resolve => events.once('received', resolve))
      await retriedBus.send(new TestCommand('abc'))
      await received
    })

    afterAll(async () => retriedBus.dispose())

    it('should start a second workflow instance', () => {
      expect(persistence.length(TestVoidStartedByWorkflowState)).toEqual(2)
    })

    it('should log the workflow name', () => {
      workflowRegistryLogger.verify(
        l =>
          l.debug(
            'Changes detected in workflow state and will be persisted.',
            It.isObjectWith({ workflowName: TestVoidStartedByWorkflow.name })
          ),
        Times.exactly(2)
      )
    })
  })
})
