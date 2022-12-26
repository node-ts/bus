import { CoreDependencies } from '../../util'
import { TestWorkflow } from '../test/test-workflow'
import { WorkflowRegistry } from './workflow-registry'
import { IMock, Mock, Times } from 'typemoq'
import { InMemoryPersistence } from '../persistence'
import { DefaultHandlerRegistry } from '../../handler'
import { ContainerAdapter } from '../../container'
import { BusInstance } from '../../service-bus'
import { DebugLogger } from '../../logger'

describe('WorkflowRegistry', () => {
  describe('when initializing', () => {
    let sut: WorkflowRegistry
    let persistence = Mock.ofType(InMemoryPersistence)

    beforeEach(() => {
      sut = new WorkflowRegistry()
      sut.register(TestWorkflow)
      sut.prepare({
          loggerFactory: (name: string) => new DebugLogger(name)
        } as unknown as CoreDependencies,
        persistence.object
      )
    })

    describe('without a container', () => {
      it('should construct workflow instances', async () => {
        await sut.initialize(new DefaultHandlerRegistry(), undefined)
      })
    })

    describe('with a container', () => {
      let container: IMock<ContainerAdapter>

      beforeEach(() => {
        container = Mock.ofType<ContainerAdapter>()
        container
          .setup(c => c.get(TestWorkflow))
          .returns(() => new TestWorkflow(Mock.ofType<BusInstance>().object))
          .verifiable(Times.once())
      })

      it('should fetch workflows from the container', async () => {
        await sut.initialize(new DefaultHandlerRegistry(), container.object)
        container.verifyAll()
      })
    })
    describe('with an async container', () => {
      let container: IMock<ContainerAdapter>

      beforeEach(() => {
        container = Mock.ofType<ContainerAdapter>()
        container
          .setup(c => c.get(TestWorkflow))
          .returns(() => Promise.resolve(new TestWorkflow(Mock.ofType<BusInstance>().object)))
          .verifiable(Times.once())
      })

      it('should fetch workflows from the container', async () => {
        await sut.initialize(new DefaultHandlerRegistry(), container.object)
        container.verifyAll()
      })
    })
  })
})
