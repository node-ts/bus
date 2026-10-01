import { Event, MessageAttributes, MessageTypes } from '@node-ts/bus-messages'
import { EventEmitter, once } from 'node:events'
import { Mock } from 'typemoq'
import {
  FailMessageOutsideHandlingContext,
  ReturnMessageOutsideHandlingContext
} from '../error'
import { handlerFor } from '../handler'
import { Logger } from '../logger'
import { JsonSerializer } from '../serialization'
import { messageTypesFor, TestCommand, testMessageTypes } from '../test'
import { InMemoryQueue, TransportMessage } from '../transport'
import { InMemoryPersistence, Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow/workflow-state'
import { Bus } from './bus'
import { BusInstance } from './bus-instance'
import { TransportAlreadyInUse } from './error'

class AuditLogged extends Event {
  static NAME = '@node-ts/bus-core/test-audit-logged'
  $name = AuditLogged.NAME
  $version = 0
}

class InvoiceIssued extends Event {
  static NAME = '@node-ts/bus-core/test-invoice-issued'
  $name = InvoiceIssued.NAME
  $version = 0

  constructor(
    readonly invoiceId: string,
    readonly issuedAt: Date
  ) {
    super()
  }
}

class InvoicePaid extends Event {
  static NAME = '@node-ts/bus-core/test-invoice-paid'
  $name = InvoicePaid.NAME
  $version = 0

  constructor(readonly invoiceId: string) {
    super()
  }
}

class ParcelShipped extends Event {
  static NAME = '@node-ts/bus-core/test-parcel-shipped'
  $name = ParcelShipped.NAME
  $version = 0

  constructor(
    readonly parcelId: string,
    readonly shippedAt: Date
  ) {
    super()
  }
}

class ParcelDelivered extends Event {
  static NAME = '@node-ts/bus-core/test-parcel-delivered'
  $name = ParcelDelivered.NAME
  $version = 0

  constructor(readonly parcelId: string) {
    super()
  }
}

class InvoiceWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-invoice-workflow-state'
  $name = InvoiceWorkflowState.NAME
  invoiceId: string
  issuedAt: Date
}

class ParcelWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-parcel-workflow-state'
  $name = ParcelWorkflowState.NAME
  parcelId: string
  shippedAt: Date
}

const invoiceMessageTypes: MessageTypes = {
  source: 'invoices',
  messages: {
    [InvoiceIssued.NAME]: 'InvoiceIssued',
    [InvoicePaid.NAME]: 'InvoicePaid',
    [InvoiceWorkflowState.NAME]: 'InvoiceWorkflowState'
  },
  types: {
    InvoiceIssued: { fields: { issuedAt: 'Date' } },
    InvoicePaid: { fields: {} },
    InvoiceWorkflowState: { fields: { issuedAt: 'Date' } }
  }
}

const parcelMessageTypes: MessageTypes = {
  source: 'parcels',
  messages: {
    [ParcelShipped.NAME]: 'ParcelShipped',
    [ParcelDelivered.NAME]: 'ParcelDelivered',
    [ParcelWorkflowState.NAME]: 'ParcelWorkflowState'
  },
  types: {
    ParcelShipped: { fields: { shippedAt: 'Date' } },
    ParcelDelivered: { fields: {} },
    ParcelWorkflowState: { fields: { shippedAt: 'Date' } }
  }
}

/**
 * An in-memory persistence that counts how often it's disposed
 */
class CountingPersistence extends InMemoryPersistence {
  disposeCount = 0

  async dispose(): Promise<void> {
    this.disposeCount++
  }
}

const silentLogger = () => Mock.ofType<Logger>().object

const caughtBy = async (action: () => Promise<void>): Promise<unknown> =>
  action().then(
    () => undefined,
    (error: unknown) => error
  )

describe('BusInstance isolation', () => {
  describe('when a bus is used inside the handler of another bus', () => {
    const events = new EventEmitter()
    let busA: BusInstance
    let busB: BusInstance
    let handledByA: MessageAttributes
    let handledByB: MessageAttributes
    let failError: unknown
    let returnError: unknown
    let handlingContextOfB: TransportMessage<unknown> | undefined
    let handlingContextOfA: TransportMessage<unknown> | undefined
    const queueA = new InMemoryQueue()

    beforeAll(async () => {
      busB = Bus.configure()
        .withLogger(silentLogger)
        .withMessageTypes(messageTypesFor(AuditLogged))
        .withHandler(
          handlerFor(AuditLogged, (_, attributes) => {
            handledByB = attributes
            events.emit('handled-by-b')
          })
        )
        .build()
      busA = Bus.configure()
        .withLogger(silentLogger)
        .withTransport(queueA)
        .withMessageTypes(testMessageTypes)
        .withHandler(
          handlerFor(TestCommand, async (_, attributes) => {
            handledByA = attributes
            handlingContextOfA = busA.getHandlingContext()
            handlingContextOfB = busB.getHandlingContext()
            await busB.publish(new AuditLogged())
            failError = await caughtBy(async () => busB.failMessage())
            returnError = await caughtBy(async () => busB.returnMessage())
            events.emit('handled-by-a')
          })
        )
        .build()
      await busB.initialize()
      await busB.start()
      await busA.initialize()
      await busA.start()

      const handled = Promise.all([
        once(events, 'handled-by-a'),
        once(events, 'handled-by-b')
      ])
      await busA.send(new TestCommand(), {
        stickyAttributes: { tenantId: 'tenant-a' }
      })
      await handled
    })

    afterAll(async () => {
      await busA.dispose()
      await busB.dispose()
    })

    it('should not give the other bus a handling context', () => {
      expect(handlingContextOfA).toBeDefined()
      expect(handlingContextOfB).toBeUndefined()
    })

    it('should start a new correlation for messages sent by the other bus', () => {
      expect(handledByB.correlationId).toBeDefined()
      expect(handledByB.correlationId).not.toEqual(handledByA.correlationId)
    })

    it('should not copy sticky attributes to messages sent by the other bus', () => {
      expect(handledByA.stickyAttributes).toEqual({ tenantId: 'tenant-a' })
      expect(handledByB.stickyAttributes).toEqual({})
    })

    it('should throw FailMessageOutsideHandlingContext from the other bus', () => {
      expect(failError).toBeInstanceOf(FailMessageOutsideHandlingContext)
    })

    it('should throw ReturnMessageOutsideHandlingContext from the other bus', () => {
      expect(returnError).toBeInstanceOf(ReturnMessageOutsideHandlingContext)
    })

    it('should complete the message of the handling bus', () => {
      expect(queueA.depth).toEqual(0)
      expect(queueA.deadLetterQueueDepth).toEqual(0)
    })
  })

  describe('when two buses share a serializer and a persistence', () => {
    const events = new EventEmitter()
    const serializer = new JsonSerializer()
    const persistence = new CountingPersistence()
    let invoiceBus: BusInstance
    let parcelBus: BusInstance
    let invoiceState: InvoiceWorkflowState
    let parcelState: ParcelWorkflowState
    let disposeCountAfterFirstBus: number

    class InvoiceWorkflow extends Workflow<InvoiceWorkflowState> {
      configureWorkflow(
        mapper: WorkflowMapper<InvoiceWorkflowState, InvoiceWorkflow>
      ): void {
        mapper
          .withState(InvoiceWorkflowState)
          .startedBy(InvoiceIssued, 'issued')
          .when(InvoicePaid, 'paid', {
            lookup: event => event.invoiceId,
            mapsTo: 'invoiceId'
          })
      }

      issued(event: InvoiceIssued): Partial<InvoiceWorkflowState> {
        events.emit('invoice-started')
        return { invoiceId: event.invoiceId, issuedAt: event.issuedAt }
      }

      paid(
        _: InvoicePaid,
        state: InvoiceWorkflowState
      ): Partial<InvoiceWorkflowState> {
        invoiceState = state
        events.emit('invoice-continued')
        return this.completeWorkflow()
      }
    }

    class ParcelWorkflow extends Workflow<ParcelWorkflowState> {
      configureWorkflow(
        mapper: WorkflowMapper<ParcelWorkflowState, ParcelWorkflow>
      ): void {
        mapper
          .withState(ParcelWorkflowState)
          .startedBy(ParcelShipped, 'shipped')
          .when(ParcelDelivered, 'delivered', {
            lookup: event => event.parcelId,
            mapsTo: 'parcelId'
          })
      }

      shipped(event: ParcelShipped): Partial<ParcelWorkflowState> {
        events.emit('parcel-started')
        return { parcelId: event.parcelId, shippedAt: event.shippedAt }
      }

      delivered(
        _: ParcelDelivered,
        state: ParcelWorkflowState
      ): Partial<ParcelWorkflowState> {
        parcelState = state
        events.emit('parcel-continued')
        return this.completeWorkflow()
      }
    }

    beforeAll(async () => {
      invoiceBus = Bus.configure()
        .withLogger(silentLogger)
        .withSerializer(serializer)
        .withPersistence(persistence)
        .withMessageTypes(invoiceMessageTypes)
        .withWorkflow(InvoiceWorkflow)
        .build()
      parcelBus = Bus.configure()
        .withLogger(silentLogger)
        .withSerializer(serializer)
        .withPersistence(persistence)
        .withMessageTypes(parcelMessageTypes)
        .withWorkflow(ParcelWorkflow)
        .build()
      await invoiceBus.initialize()
      await invoiceBus.start()
      await parcelBus.initialize()
      await parcelBus.start()

      const started = Promise.all([
        once(events, 'invoice-started'),
        once(events, 'parcel-started')
      ])
      await invoiceBus.publish(new InvoiceIssued('invoice-1', new Date(1)))
      await parcelBus.publish(new ParcelShipped('parcel-1', new Date(2)))
      await started
      const continued = Promise.all([
        once(events, 'invoice-continued'),
        once(events, 'parcel-continued')
      ])
      await invoiceBus.publish(new InvoicePaid('invoice-1'))
      await parcelBus.publish(new ParcelDelivered('parcel-1'))
      await continued

      await invoiceBus.dispose()
      disposeCountAfterFirstBus = persistence.disposeCount
      await parcelBus.dispose()
    })

    it('should restore each workflow state with the message types of its own bus', () => {
      expect(invoiceState.issuedAt).toEqual(new Date(1))
      expect(parcelState.shippedAt).toEqual(new Date(2))
    })

    it('should only dispose the persistence when the last bus is disposed', () => {
      expect(disposeCountAfterFirstBus).toEqual(0)
      expect(persistence.disposeCount).toEqual(1)
    })
  })

  describe('when a transport is used by a second bus', () => {
    let buildError: unknown

    beforeAll(() => {
      const transport = new InMemoryQueue()
      Bus.configure().withLogger(silentLogger).withTransport(transport).build()
      try {
        Bus.configure()
          .withLogger(silentLogger)
          .withTransport(transport)
          .build()
      } catch (error) {
        buildError = error
      }
    })

    it('should throw TransportAlreadyInUse naming the transport', () => {
      expect(buildError).toBeInstanceOf(TransportAlreadyInUse)
      expect((buildError as TransportAlreadyInUse).transportName).toEqual(
        'InMemoryQueue'
      )
    })
  })
})
