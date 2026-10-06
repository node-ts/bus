import { MessageTypes } from '@node-ts/bus-messages'
import { It, Mock, Times } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { ProvisioningPlan, ResourcesNotProvisioned } from '../provisioning'
import { messageTypesFor, testMessageTypes } from '../test'
import { TestEvent } from '../test/test-event'
import {
  InMemoryQueue,
  TransportConnectionOptions,
  TransportInitializationOptions,
  TransportProvisionOptions
} from '../transport'
import {
  InMemoryPersistence,
  PersistenceInitializationOptions,
  PersistenceProvisionOptions,
  Workflow,
  WorkflowMapper
} from '../workflow'
import {
  testFunctionWorkflow,
  TestFunctionWorkflowState
} from '../workflow/test/test-function-workflow'
import { TestWorkflowState } from '../workflow/test/test-workflow-state'
import { Bus } from './bus'
import { BusConfiguration } from './bus-configuration'
import { BusInstance } from './bus-instance'

/**
 * A workflow that can't be constructed, so registering it fails
 */
class UnconstructableWorkflow extends Workflow<TestWorkflowState> {
  constructor() {
    super()
    throw new Error('UnconstructableWorkflow failed to construct')
  }

  configureWorkflow(
    mapper: WorkflowMapper<TestWorkflowState, UnconstructableWorkflow>
  ): void {
    mapper.withState(TestWorkflowState)
  }
}

/**
 * A workflow state class from another copy of @node-ts/bus-core, which isn't an `instanceof` this one's
 */
const OtherCopyWorkflowState = (() => {
  abstract class WorkflowState {
    abstract readonly $name: string
  }
  return class OtherCopyWorkflowState extends WorkflowState {
    $name = 'other-copy-workflow-state'
  }
})()

/**
 * An in-memory queue that records how it's connected, provisioned and initialized, in order
 */
class ProvisioningQueue extends InMemoryQueue {
  readonly calls: string[] = []
  provisionOptions: TransportProvisionOptions | undefined
  initializationOptions: TransportInitializationOptions | undefined
  missingResources: string[] = []

  async connect(_: TransportConnectionOptions): Promise<void> {
    this.calls.push('transport.connect')
  }

  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    this.calls.push(`transport.provision${options.dryRun ? ' (dry run)' : ''}`)
    this.provisionOptions = options
    return {
      adapter: 'ProvisioningQueue',
      resources: options.messageNames.map(name => ({ type: 'topic', name }))
    }
  }

  async initialize(options: TransportInitializationOptions): Promise<void> {
    this.calls.push('transport.initialize')
    this.initializationOptions = options
    if (options.verifyResources && this.missingResources.length) {
      throw new ResourcesNotProvisioned(
        'ProvisioningQueue',
        this.missingResources
      )
    }
    await super.initialize(options)
  }
}

/**
 * An in-memory persistence that records how it's provisioned and initialized, into its queue's calls
 */
class ProvisioningPersistence extends InMemoryPersistence {
  provisionOptions: PersistenceProvisionOptions | undefined
  initializationOptions: PersistenceInitializationOptions | undefined

  constructor(private readonly calls: string[]) {
    super()
  }

  async provision(
    options: PersistenceProvisionOptions
  ): Promise<ProvisioningPlan> {
    this.calls.push(
      `persistence.provision${options.dryRun ? ' (dry run)' : ''}`
    )
    this.provisionOptions = options
    return {
      adapter: 'ProvisioningPersistence',
      resources: options.workflows.map(({ workflowStateType }) => ({
        type: 'table',
        name: new workflowStateType().$name
      }))
    }
  }

  async initialize(options: PersistenceInitializationOptions): Promise<void> {
    this.calls.push('persistence.initialize')
    this.initializationOptions = options
    await super.initialize(options)
  }
}

describe('BusInstance provisioning', () => {
  let transport: ProvisioningQueue
  let persistence: ProvisioningPersistence

  const configure = (): BusConfiguration => {
    transport = new ProvisioningQueue()
    persistence = new ProvisioningPersistence(transport.calls)
    return Bus.configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withMessageTypes(testMessageTypes)
      .withTransport(transport)
      .withPersistence(persistence)
      .withHandler(handlerFor(TestEvent, () => undefined))
      .withWorkflow(testFunctionWorkflow)
  }

  describe('when the bus is initialized without auto provisioning', () => {
    let sut: BusInstance

    beforeAll(async () => {
      sut = configure().build()
      await sut.initialize()
    })

    afterAll(async () => sut.dispose())

    it('should provision nothing', () => {
      expect(transport.calls).toEqual([
        'persistence.initialize',
        'transport.connect',
        'transport.initialize'
      ])
    })

    it('should ask the transport to verify its resources', () => {
      expect(transport.initializationOptions).toMatchObject({
        verifyResources: true,
        autoProvision: false,
        sendOnly: false
      })
    })

    it('should ask the persistence to verify the storage of each workflow', () => {
      expect(persistence.initializationOptions?.verifyResources).toEqual(true)
      expect(
        persistence.initializationOptions?.workflows.map(
          w => w.workflowStateType
        )
      ).toEqual([TestFunctionWorkflowState])
    })

    it('should pass the transport every message handled or typed, without the state of its workflows', () => {
      const messageNames = transport.initializationOptions!.messageNames
      expect(messageNames).toContain(TestEvent.NAME)
      expect(messageNames).not.toContain(TestFunctionWorkflowState.NAME)
    })
  })

  describe('when a resource is missing', () => {
    let sut: BusInstance
    let error: unknown

    beforeAll(async () => {
      sut = configure().build()
      transport.missingResources = ['queue orders']
      error = await sut.initialize().catch((e: unknown) => e)
    })

    afterAll(async () => sut.dispose())

    it('should fail to initialize, naming what is missing and the fix', () => {
      expect(error).toBeInstanceOf(ResourcesNotProvisioned)
      expect((error as ResourcesNotProvisioned).message).toContain(
        'queue orders'
      )
      expect((error as ResourcesNotProvisioned).help).toContain('bus provision')
    })
  })

  describe('when the bus is configured with withResourceVerification(false)', () => {
    let sut: BusInstance

    beforeAll(async () => {
      sut = configure().withResourceVerification(false).build()
      transport.missingResources = ['queue orders']
      await sut.initialize()
    })

    afterAll(async () => sut.dispose())

    it('should not ask the adapters to verify their resources', () => {
      expect(transport.initializationOptions?.verifyResources).toEqual(false)
      expect(persistence.initializationOptions?.verifyResources).toEqual(false)
    })
  })

  describe('when the bus is configured with withAutoProvision()', () => {
    let sut: BusInstance

    beforeAll(async () => {
      sut = configure().withAutoProvision().build()
      await sut.initialize()
    })

    afterAll(async () => sut.dispose())

    it('should provision before initializing, connecting the transport once', () => {
      expect(transport.calls).toEqual([
        'persistence.provision',
        'transport.connect',
        'transport.provision',
        'persistence.initialize',
        'transport.initialize'
      ])
    })

    it('should not verify what it has just provisioned', () => {
      expect(transport.initializationOptions).toMatchObject({
        verifyResources: false,
        autoProvision: true
      })
      expect(persistence.initializationOptions?.verifyResources).toEqual(false)
    })

    it('should provision the storage of each workflow', () => {
      expect(
        persistence.provisionOptions?.workflows.map(w => w.workflowStateType)
      ).toEqual([TestFunctionWorkflowState])
    })
  })

  describe('when the bus is provisioned', () => {
    let sut: BusInstance
    let plans: ProvisioningPlan[]

    beforeAll(async () => {
      sut = configure().build()
      plans = await sut.provision()
    })

    afterAll(async () => sut.dispose())

    it('should return the plan of each adapter', () => {
      expect(plans.map(plan => plan.adapter)).toEqual([
        'ProvisioningPersistence',
        'ProvisioningQueue'
      ])
    })

    it('should provision the workflows and handled messages', () => {
      expect(plans[0].resources).toEqual([
        { type: 'table', name: TestFunctionWorkflowState.NAME }
      ])
      expect(transport.provisionOptions?.messageNames).toContain(TestEvent.NAME)
    })

    it('should not initialize the bus', () => {
      expect(transport.calls).not.toContain('transport.initialize')
      expect(transport.calls).not.toContain('persistence.initialize')
    })

    describe('and then initialized', () => {
      beforeAll(async () => sut.initialize())

      it('should connect the transport only once', () => {
        expect(
          transport.calls.filter(call => call === 'transport.connect')
        ).toHaveLength(1)
      })

      it('should still verify the resources', () => {
        expect(transport.initializationOptions?.verifyResources).toEqual(true)
      })
    })
  })

  describe('when a dry run is provisioned', () => {
    let sut: BusInstance

    beforeAll(async () => {
      sut = configure().build()
      await sut.provision({ dryRun: true })
    })

    afterAll(async () => sut.dispose())

    it('should not connect the transport', () => {
      expect(transport.calls).toEqual([
        'persistence.provision (dry run)',
        'transport.provision (dry run)'
      ])
    })
  })

  describe('when a send-only bus is provisioned', () => {
    let sut: BusInstance
    const sendOnlyMessageTypes: MessageTypes = {
      messages: {
        ...messageTypesFor(TestEvent).messages,
        [TestWorkflowState.NAME]: 'workflow-state',
        'other-copy-workflow-state': 'other-copy-workflow-state'
      },
      types: {
        ...messageTypesFor(TestEvent).types,
        'workflow-state': { class: TestWorkflowState, fields: {} },
        'other-copy-workflow-state': {
          class: OtherCopyWorkflowState,
          fields: {}
        }
      }
    }

    beforeAll(async () => {
      transport = new ProvisioningQueue()
      sut = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(sendOnlyMessageTypes)
        .withTransport(transport)
        .asSendOnly()
        .build()
      await sut.provision()
    })

    afterAll(async () => sut.dispose())

    it('should provision a topic for each message type, but not workflow state, from any copy of bus-core', () => {
      expect(transport.provisionOptions).toMatchObject({
        sendOnly: true,
        messageNames: [TestEvent.NAME],
        sendsAnyMessage: false
      })
    })
  })

  describe('when a send-only bus without message types is provisioned', () => {
    let sut: BusInstance
    const logger = Mock.ofType<Logger>()

    beforeAll(async () => {
      sut = Bus.configure()
        .withLogger(() => logger.object)
        .withTransport(new ProvisioningQueue())
        .asSendOnly()
        .build()
      await sut.provision({ dryRun: true })
    })

    afterAll(async () => sut.dispose())

    it('should warn that it provisions nothing to send to', () => {
      logger.verify(
        l =>
          l.warn(
            It.is((message: string) => message.includes('withMessageTypes()'))
          ),
        Times.once()
      )
    })
  })

  describe('when a scheduler is provisioned', () => {
    let sut: BusInstance

    beforeAll(async () => {
      transport = new ProvisioningQueue()
      sut = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(transport)
        .withPersistence(new InMemoryPersistence())
        .asScheduler()
        .build()
      await sut.provision({ dryRun: true })
    })

    afterAll(async () => sut.dispose())

    it('should tell the transport it may send any message', () => {
      expect(transport.provisionOptions).toMatchObject({
        sendOnly: true,
        sendsAnyMessage: true
      })
    })
  })

  describe('when registering the workflows fails', () => {
    let sut: BusInstance
    let provisionError: unknown
    let initializeError: unknown

    beforeAll(async () => {
      sut = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(testMessageTypes)
        .withTransport(new ProvisioningQueue())
        .withWorkflow(UnconstructableWorkflow)
        .build()
      provisionError = await sut.provision().catch((e: unknown) => e)
      initializeError = await sut.initialize().catch((e: unknown) => e)
    })

    afterAll(async () => sut.dispose())

    it('should fail provisioning', () => {
      expect((provisionError as Error).message).toEqual(
        'UnconstructableWorkflow failed to construct'
      )
    })

    it('should fail initializing with the same error, rather than skip registering', () => {
      expect(initializeError).toBe(provisionError)
    })
  })
})
