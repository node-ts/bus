import { BusConfiguration, BusInstance, handlerFor } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  TestAddress,
  TestBigIntCommand,
  TestCustomer,
  TestGeoPoint,
  TestOrderLine,
  TestRoundTripCommand
} from './helpers'

interface Received<T> {
  message: T
  attributes: MessageAttributes
}

const createGeoPoint = (latitude: number, surveyedAt: Date): TestGeoPoint =>
  Object.assign(new TestGeoPoint(), { latitude, longitude: 151.2, surveyedAt })

const createAddress = (street: string, location: TestGeoPoint): TestAddress =>
  Object.assign(new TestAddress(), { street, city: 'Sydney', location })

const createOrderLine = (
  sku: string,
  quantity: number,
  addedAt: Date
): TestOrderLine =>
  Object.assign(new TestOrderLine(), {
    sku,
    quantity,
    unitPrice: 2.5,
    addedAt
  })

/**
 * Creates a command that sets every kind of field the round trip checks
 */
export const createTestRoundTripCommand = (): TestRoundTripCommand => {
  const customer = Object.assign(new TestCustomer(), {
    name: 'Ada',
    address: createAddress(
      '1 Main St',
      createGeoPoint(-33.8, new Date('2020-01-02T03:04:05.006Z'))
    ),
    previousAddresses: [
      createAddress(
        '2 Old Rd',
        createGeoPoint(51.5, new Date('2019-01-01T00:00:00.000Z'))
      )
    ],
    joinedAt: new Date('2018-05-06T07:08:09.010Z')
  })
  const lines = [
    createOrderLine('sku-1', 2, new Date('2021-01-01T00:00:00.000Z')),
    createOrderLine('sku-2', 3, new Date('2021-01-02T00:00:00.000Z'))
  ]
  return Object.assign(new TestRoundTripCommand(), {
    id: randomUUID(),
    placedAt: new Date('2021-02-03T04:05:06.007Z'),
    customer,
    lines,
    reminders: [
      new Date('2021-03-01T00:00:00.000Z'),
      new Date('2021-04-01T00:00:00.000Z')
    ],
    linesBySku: new Map(lines.map(line => [line.sku, line])),
    tags: new Set(['priority', 'gift']),
    shippedAt: new Date('2021-02-04T00:00:00.000Z'),
    cancelledAt: null,
    referrer: null,
    // Left out of the payload, so only the receiver can fill it in
    channel: undefined,
    untypedDate: new Date('2021-05-06T07:08:09.010Z')
  })
}

/**
 * Collects what the round trip handlers receive
 */
export class RoundTripReceiver {
  readonly events = new EventEmitter()
  roundTripCommand: Received<TestRoundTripCommand> | undefined
  bigIntCommand: TestBigIntCommand | undefined

  /**
   * Registers the handlers that `messageRoundTripCases` needs with the bus under test
   * @param configuration the configuration of the bus under test
   * @returns the configuration, for chaining
   */
  withHandlers(configuration: BusConfiguration): BusConfiguration {
    return configuration
      .withHandler(
        handlerFor(TestRoundTripCommand, (message, attributes) => {
          this.roundTripCommand = { message, attributes }
          this.events.emit('received')
        })
      )
      .withHandler(
        handlerFor(TestBigIntCommand, message => {
          this.bigIntCommand = message
          this.events.emit('received-big-int')
        })
      )
  }
}

/**
 * Sends messages with nested types through the bus and checks what arrives at the handler.
 * The bus must be started with `receiver.withHandlers()` applied.
 * @param getBus gets the started bus that the messages are sent through
 * @param receiver collects what the handlers received
 */
export const messageRoundTripCases = (
  getBus: () => BusInstance,
  receiver: RoundTripReceiver
): void => {
  describe('when sending a message with nested types', () => {
    const sent = createTestRoundTripCommand()
    const messageOptions: MessageAttributes = {
      correlationId: randomUUID(),
      attributes: { attribute1: 'a', attribute2: 1 },
      stickyAttributes: { sticky1: 'b', sticky2: 2 }
    }
    let message: TestRoundTripCommand
    let attributes: MessageAttributes

    beforeAll(async () => {
      const received = new Promise(resolve =>
        receiver.events.once('received', resolve)
      )
      await getBus().send(sent, messageOptions)
      await received
      ;({ message, attributes } = receiver.roundTripCommand!)
    })

    it('should arrive as an instance of its class', () => {
      expect(message).toBeInstanceOf(TestRoundTripCommand)
      expect(message.id).toEqual(sent.id)
    })

    it('should keep its $name and $version', () => {
      expect(message.$name).toEqual(TestRoundTripCommand.NAME)
      expect(message.$version).toEqual(2)
    })

    it('should run its getters and prototype methods', () => {
      expect(message.lineCount).toEqual(2)
      expect(message.orderTotal()).toEqual(12.5)
    })

    it('should restore a Date field', () => {
      expect(message.placedAt).toBeInstanceOf(Date)
      expect(message.placedAt.getTime()).toEqual(sent.placedAt.getTime())
    })

    it('should restore nested class instances several levels deep', () => {
      const { customer } = message
      expect(customer).toBeInstanceOf(TestCustomer)
      expect(customer.joinedAt).toBeInstanceOf(Date)
      expect(customer.joinedAt.getTime()).toEqual(
        sent.customer.joinedAt.getTime()
      )
      expect(customer.address).toBeInstanceOf(TestAddress)
      expect(customer.address.label).toEqual('1 Main St, Sydney')
      expect(customer.address.location).toBeInstanceOf(TestGeoPoint)
      expect(customer.address.location.coordinates).toEqual('-33.8,151.2')
      expect(customer.address.location.isNorthern()).toEqual(false)
      expect(customer.address.location.surveyedAt).toBeInstanceOf(Date)
      expect(customer.address.location.surveyedAt.toISOString()).toEqual(
        '2020-01-02T03:04:05.006Z'
      )
    })

    it('should restore arrays of class instances', () => {
      expect(message.lines).toHaveLength(2)
      message.lines.forEach((line, index) => {
        expect(line).toBeInstanceOf(TestOrderLine)
        expect(line.addedAt).toBeInstanceOf(Date)
        expect(line.addedAt.getTime()).toEqual(
          sent.lines[index].addedAt.getTime()
        )
      })
      expect(message.lines[1].total()).toEqual(7.5)

      const [previousAddress] = message.customer.previousAddresses
      expect(previousAddress).toBeInstanceOf(TestAddress)
      expect(previousAddress.location).toBeInstanceOf(TestGeoPoint)
      expect(previousAddress.location.isNorthern()).toEqual(true)
    })

    it('should restore arrays of Dates', () => {
      expect(message.reminders).toHaveLength(2)
      message.reminders.forEach((reminder, index) => {
        expect(reminder).toBeInstanceOf(Date)
        expect(reminder.getTime()).toEqual(sent.reminders[index].getTime())
      })
    })

    it('should restore a Map of class instances', () => {
      expect(message.linesBySku).toBeInstanceOf(Map)
      expect([...message.linesBySku.keys()]).toEqual(['sku-1', 'sku-2'])
      const line = message.linesBySku.get('sku-2')!
      expect(line).toBeInstanceOf(TestOrderLine)
      expect(line.addedAt).toBeInstanceOf(Date)
      expect(line.total()).toEqual(7.5)
    })

    it('should restore a Set', () => {
      expect(message.tags).toBeInstanceOf(Set)
      expect([...message.tags]).toEqual(['priority', 'gift'])
    })

    it('should restore an optional field that is set', () => {
      expect(message.shippedAt).toBeInstanceOf(Date)
      expect(message.shippedAt!.getTime()).toEqual(sent.shippedAt!.getTime())
    })

    it('should leave optional fields that are not set undefined', () => {
      expect(message.note).toBeUndefined()
      expect(message.deliveredAt).toBeUndefined()
      expect(message.billingAddress).toBeUndefined()
    })

    it('should keep null fields null', () => {
      expect(message.cancelledAt).toBeNull()
      expect(message.referrer).toBeNull()
    })

    // Messages are created from their class' prototype without running the constructor, so field
    // initializers don't fill in fields that are missing from the payload. Under class-transformer the
    // constructor ran with no arguments, which set them, and threw for constructors that use their arguments.
    it('should not run field initializers for fields missing from the payload', () => {
      expect(message.channel).toBeUndefined()
    })

    // class-transformer silently left this Date as a string because it had no `@Type(() => Date)`
    it('should restore a Date that had no type hint', () => {
      expect(message.untypedDate).toBeInstanceOf(Date)
      expect(message.untypedDate.getTime()).toEqual(sent.untypedDate.getTime())
    })

    it('should keep the message attributes', () => {
      expect(attributes.correlationId).toEqual(messageOptions.correlationId)
      expect(attributes.attributes).toEqual(messageOptions.attributes)
      expect(attributes.stickyAttributes).toEqual(
        messageOptions.stickyAttributes
      )
    })
  })

  describe('when sending a message with a bigint field', () => {
    const sent = Object.assign(new TestBigIntCommand(), {
      id: randomUUID(),
      amount: 2n ** 64n
    })
    let message: TestBigIntCommand

    beforeAll(async () => {
      const received = new Promise(resolve =>
        receiver.events.once('received-big-int', resolve)
      )
      await getBus().send(sent)
      await received
      message = receiver.bigIntCommand!
    })

    // JSON.stringify couldn't serialize a bigint, so under class-transformer the send failed
    it('should restore the bigint', () => {
      expect(message).toBeInstanceOf(TestBigIntCommand)
      expect(message.amount).toEqual(2n ** 64n)
    })
  })
}
