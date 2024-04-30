import { Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { TestCommand } from '../test/test-command'
import { TestEvent } from '../test/test-event'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'
import { sleep } from '../util'
import { InMemoryQueue } from '../transport'
import { Workflow, WorkflowMapper, WorkflowState } from '../workflow'

describe('BusInstance Outboxing', () => {
  describe('when a message is sent from two handlers, and one fails', () => {
    let bus: BusInstance
    const testEventCallback = Mock.ofType<(source: string) => void>()
    const inMemoryTransport = new InMemoryQueue({
      maxRetries: 0,
      receiveTimeoutMs: 100
    })

    beforeAll(async () => {
      bus = Bus.configure()
        .withTransport(inMemoryTransport)
        .withHandler(
          handlerFor(TestCommand, async () => {
            await bus.send(new TestEvent('failing-handler'))
            throw new Error('Failing Handler')
          })
        )
        .withHandler(
          handlerFor(TestCommand, async () => {
            await bus.send(new TestEvent('success-handler'))
          })
        )
        .withHandler(
          handlerFor(TestEvent, async (event: TestEvent) => {
            testEventCallback.object(event.property1!)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()

      await bus.send(new TestCommand())
      await sleep(1_000)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should send the non-failing handler message to the transport', async () => {
      testEventCallback.verify(t => t('success-handler'), Times.once())
    })

    it('should not send the message from the failing handler to the transport', async () => {
      testEventCallback.verify(t => t('failing-handler'), Times.never())
    })
  })

  describe('when a message is sent in a workflow handler, that fails to persist', () => {
    let bus: BusInstance
    const testCommandCallback = Mock.ofType<() => void>()
    const testEventCallback = Mock.ofType<(source: string) => void>()
    const inMemoryTransport = new InMemoryQueue({
      maxRetries: 0,
      receiveTimeoutMs: 100
    })

    class TestWorkflowState extends WorkflowState {
      static NAME = 'TestWorkflowState'
      $name = TestWorkflowState.NAME
    }

    class TestWorkflow extends Workflow<TestWorkflowState> {
      configureWorkflow(
        mapper: WorkflowMapper<TestWorkflowState, TestWorkflow>
      ): void {
        mapper.withState(TestWorkflowState).startedBy(TestCommand, 'step1')
      }

      async step1(): Promise<Partial<TestWorkflowState>> {
        testCommandCallback.object()
        await bus.send(new TestEvent('failed-workflow'))
        throw new Error('Error in workflow')
      }
    }

    beforeAll(async () => {
      bus = Bus.configure()
        .withTransport(inMemoryTransport)
        .withWorkflow(TestWorkflow)
        .withHandler(
          handlerFor(TestEvent, async (event: TestEvent) => {
            testEventCallback.object(event.property1!)
          })
        )
        .build()

      await bus.initialize()
      await bus.start()

      await bus.send(new TestCommand())
      await sleep(1_000)
    })

    afterAll(async () => {
      await bus.dispose()
    })

    it('should not send the message to the transport', async () => {
      testCommandCallback.verify(t => t(), Times.once())
      testEventCallback.verify(t => t('failed-workflow'), Times.never())
    })
  })
})
