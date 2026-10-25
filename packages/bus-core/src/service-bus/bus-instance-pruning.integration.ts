import { Mock } from 'typemoq'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { PruneIncomplete, PruneRefused, PruningPlan } from '../provisioning'
import { testMessageTypes } from '../test'
import { TestEvent } from '../test/test-event'
import { TestSystemMessage } from '../test/test-system-message'
import {
  InMemoryQueue,
  TransportConnectionOptions,
  TransportPruneOptions
} from '../transport'
import { InMemoryPersistence } from '../workflow'
import { testFunctionWorkflow } from '../workflow/test/test-function-workflow'
import { Bus } from './bus'
import { BusConfiguration } from './bus-configuration'
import { BusInstance } from './bus-instance'

/**
 * An in-memory queue that records how it's connected and pruned, and reports one orphaned subscription
 */
class PruningQueue extends InMemoryQueue {
  readonly calls: string[] = []
  pruneOptions: TransportPruneOptions | undefined
  handledMessageNames: string[] = []
  /**
   * The error removing the orphaned subscription fails with, if any
   */
  removeError: Error | undefined

  async connect(_: TransportConnectionOptions): Promise<void> {
    this.calls.push('transport.connect')
  }

  async prune(options: TransportPruneOptions): Promise<PruningPlan> {
    this.calls.push(`transport.prune${options.apply ? ' (apply)' : ''}`)
    this.pruneOptions = options
    this.handledMessageNames = options.handlerRegistry.getMessageNames()
    const resources = [
      { type: 'subscription', name: 'orphaned-topic' },
      { type: 'subscription', name: 'other-orphaned-topic' }
    ]
    return {
      adapter: 'PruningQueue',
      resources,
      removed: options.apply ? resources.slice(this.removeError ? 1 : 0) : [],
      failed:
        options.apply && this.removeError
          ? [{ resource: resources[0], error: this.removeError }]
          : [],
      notFound: []
    }
  }
}

describe('BusInstance pruning', () => {
  let transport: PruningQueue

  const configure = (): BusConfiguration => {
    transport = new PruningQueue()
    return Bus.configure()
      .withLogger(() => Mock.ofType<Logger>().object)
      .withMessageTypes(testMessageTypes)
      .withTransport(transport)
      .withPersistence(new InMemoryPersistence())
      .withHandler(handlerFor(TestEvent, () => undefined))
      .withWorkflow(testFunctionWorkflow)
  }

  describe('when the bus is pruned without apply', () => {
    let sut: BusInstance
    let plans: PruningPlan[]

    beforeAll(async () => {
      sut = configure().build()
      plans = await sut.prune()
    })

    afterAll(async () => sut.dispose())

    it('should connect the transport, then prune it without removing anything', () => {
      expect(transport.calls).toEqual(['transport.connect', 'transport.prune'])
      expect(transport.pruneOptions).toMatchObject({
        apply: false,
        sendOnly: false,
        sendsAnyMessage: false
      })
    })

    it("should pass the handlers and the workflows' messages", () => {
      expect(transport.handledMessageNames).toContain(TestEvent.NAME)
      expect(transport.handledMessageNames.length).toBeGreaterThan(1)
    })

    it('should return the plan of the transport', () => {
      expect(plans).toEqual([
        {
          adapter: 'PruningQueue',
          resources: [
            { type: 'subscription', name: 'orphaned-topic' },
            { type: 'subscription', name: 'other-orphaned-topic' }
          ],
          removed: [],
          failed: [],
          notFound: []
        }
      ])
    })
  })

  describe('when the bus is pruned with apply', () => {
    let sut: BusInstance
    let plans: PruningPlan[]

    beforeAll(async () => {
      sut = configure().build()
      plans = await sut.prune({ apply: true })
    })

    afterAll(async () => sut.dispose())

    it('should tell the transport to remove what it finds', () => {
      expect(transport.pruneOptions?.apply).toEqual(true)
      expect(plans[0].removed).toHaveLength(2)
    })
  })

  describe('when the bus is pruned with what was approved', () => {
    const only = [{ type: 'subscription', name: 'orphaned-topic' }]
    let sut: BusInstance

    beforeAll(async () => {
      sut = configure().build()
      await sut.prune({ apply: true, only })
    })

    afterAll(async () => sut.dispose())

    it('should pass it to the transport', () => {
      expect(transport.pruneOptions?.only).toEqual(only)
    })
  })

  describe('when the transport fails to remove something', () => {
    let sut: BusInstance
    let error: unknown

    beforeAll(async () => {
      sut = configure().build()
      transport.removeError = new Error('Access denied')
      error = await sut.prune({ apply: true }).catch((e: unknown) => e)
    })

    afterAll(async () => sut.dispose())

    it('should throw, with what was removed and what failed', () => {
      expect(error).toBeInstanceOf(PruneIncomplete)
      const { plans, message, help } = error as PruneIncomplete
      expect(plans[0].removed).toEqual([
        { type: 'subscription', name: 'other-orphaned-topic' }
      ])
      expect(plans[0].failed).toEqual([
        {
          resource: { type: 'subscription', name: 'orphaned-topic' },
          error: transport.removeError
        }
      ])
      expect(message).toContain('removed 1 of 2 resources')
      expect(message).toContain('orphaned-topic, failed with: Access denied')
      expect(help).toContain('prune again')
    })
  })

  describe('when the transport does not prune', () => {
    let sut: BusInstance
    let plans: PruningPlan[]

    beforeAll(async () => {
      sut = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(testMessageTypes)
        .withHandler(handlerFor(TestEvent, () => undefined))
        .build()
      plans = await sut.prune()
    })

    afterAll(async () => sut.dispose())

    it('should return no plans', () => {
      expect(plans).toEqual([])
    })
  })

  describe('when a send-only bus is pruned', () => {
    let sut: BusInstance
    let error: unknown

    beforeAll(async () => {
      transport = new PruningQueue()
      sut = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(transport)
        .asSendOnly()
        .build()
      error = await sut.prune({ apply: true }).catch((e: unknown) => e)
    })

    afterAll(async () => sut.dispose())

    it('should refuse, saying it is send-only', () => {
      expect(error).toBeInstanceOf(PruneRefused)
      expect(error).toMatchObject({ reason: 'send-only' })
      expect((error as PruneRefused).help).toContain('asSendOnly()')
    })

    it('should not prune the transport', () => {
      expect(transport.calls).toEqual([])
    })
  })

  describe('when a scheduler is pruned', () => {
    let sut: BusInstance
    let error: unknown

    beforeAll(async () => {
      transport = new PruningQueue()
      sut = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(transport)
        .withPersistence(new InMemoryPersistence())
        .asScheduler()
        .build()
      error = await sut.prune().catch((e: unknown) => e)
    })

    afterAll(async () => sut.dispose())

    it('should refuse, saying it is a scheduler', () => {
      expect(error).toBeInstanceOf(PruneRefused)
      expect(error).toMatchObject({ reason: 'scheduler' })
      expect(transport.calls).toEqual([])
    })
  })

  describe('when a bus that handles nothing is pruned', () => {
    const configureEmpty = () => {
      transport = new PruningQueue()
      return Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(transport)
        .build()
    }

    describe('without allowEmpty', () => {
      let sut: BusInstance
      let error: unknown

      beforeAll(async () => {
        sut = configureEmpty()
        error = await sut.prune({ apply: true }).catch((e: unknown) => e)
      })

      afterAll(async () => sut.dispose())

      it('should refuse, naming the queue and how to allow it', () => {
        expect(error).toBeInstanceOf(PruneRefused)
        expect(error).toMatchObject({
          reason: 'handles-nothing',
          endpointName: transport.endpointName
        })
        expect((error as PruneRefused).help).toContain('--allow-empty')
        expect(transport.calls).toEqual([])
      })
    })

    describe('with allowEmpty', () => {
      let sut: BusInstance

      beforeAll(async () => {
        sut = configureEmpty()
        await sut.prune({ allowEmpty: true })
      })

      afterAll(async () => sut.dispose())

      it('should prune it', () => {
        expect(transport.calls).toEqual([
          'transport.connect',
          'transport.prune'
        ])
      })
    })
  })

  describe('when a bus only handles messages of a custom handler with a topic', () => {
    let sut: BusInstance

    beforeAll(async () => {
      transport = new PruningQueue()
      sut = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withTransport(transport)
        .withCustomHandler(async (_: TestSystemMessage) => undefined, {
          resolveWith: message => message.name === TestSystemMessage.NAME,
          topicIdentifier: 'external-topic'
        })
        .build()
      await sut.prune()
    })

    afterAll(async () => sut.dispose())

    it('should prune it, keeping the custom handler topic', () => {
      expect(
        transport.pruneOptions?.handlerRegistry.getExternallyManagedTopicIdentifiers()
      ).toEqual(['external-topic'])
    })
  })

  describe('when a bus has a custom handler without a topic', () => {
    let sut: BusInstance
    let error: unknown

    beforeAll(async () => {
      sut = configure()
        .withCustomHandler(async (_: TestSystemMessage) => undefined, {
          resolveWith: message => message.name === TestSystemMessage.NAME
        })
        .build()
      error = await sut.prune().catch((e: unknown) => e)
    })

    afterAll(async () => sut.dispose())

    it('should refuse, since its subscription may have been made by hand', () => {
      expect(error).toBeInstanceOf(PruneRefused)
      expect(error).toMatchObject({ reason: 'custom-handler-without-topic' })
      expect((error as PruneRefused).help).toContain('topicIdentifier')
      expect((error as PruneRefused).help).toContain(
        'allowCustomHandlersWithoutTopic: true'
      )
      expect((error as PruneRefused).help).toContain('--allow-custom-handlers')
      expect(transport.calls).toEqual([])
    })

    describe('and it is pruned with allowCustomHandlersWithoutTopic', () => {
      let allowed: BusInstance

      beforeAll(async () => {
        allowed = configure()
          .withCustomHandler(async (_: TestSystemMessage) => undefined, {
            resolveWith: message => message.name === TestSystemMessage.NAME
          })
          .build()
        await allowed.prune({ allowCustomHandlersWithoutTopic: true })
      })

      afterAll(async () => allowed.dispose())

      it('should prune it', () => {
        expect(transport.calls).toEqual([
          'transport.connect',
          'transport.prune'
        ])
      })
    })
  })
})
