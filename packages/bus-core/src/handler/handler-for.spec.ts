import { MessageAttributes, messageAttributes } from '@node-ts/bus-messages'
import {
  TestCommand,
  TestCommand2,
  TestCommandContextClassHandler,
  TestDefinedCommand
} from '../test'
import { HandlerContext } from './handler-context'
import { handlerFor } from './handler-for'

type TenantAttributes = MessageAttributes<{ tenantId: string }>

const context: HandlerContext = {
  correlationId: undefined,
  send: async () => undefined,
  publish: async () => undefined,
  failMessage: async () => undefined,
  returnMessage: async () => undefined
}

// Each handler below only compiles if handlerFor's typing allows it; the @ts-expect-error lines fail the type check
// if the code they mark is accepted
const returnsValueHandler = handlerFor(
  TestCommand,
  async command => command.$name
)

const definedReturnsValueHandler = handlerFor(
  TestDefinedCommand,
  command => command.orderId
)

const tenantHandler = handlerFor<TestCommand, TenantAttributes>(
  TestCommand,
  async (_, attributes) => {
    const tenantId: string = attributes.attributes.tenantId
    // @ts-expect-error tenantId is a string
    const notANumber: number = attributes.attributes.tenantId
    // @ts-expect-error the attributes only declare tenantId
    void attributes.attributes.userId
    return [tenantId, notANumber]
  }
)

const definedTenantHandler = handlerFor<TestDefinedCommand, TenantAttributes>(
  TestDefinedCommand,
  async (command, attributes, ctx) =>
    `${command.orderId}:${attributes.attributes.tenantId}:${ctx.correlationId}`
)

const explicitClassHandler = handlerFor<TestCommand2>(
  TestCommand2,
  TestCommandContextClassHandler
)

const messageOnlyHandler = handlerFor(TestCommand, command => command.$version)

describe('handlerFor', () => {
  describe('when a function handler returns a value', () => {
    let results: unknown[]

    beforeAll(async () => {
      results = [
        await returnsValueHandler.messageHandler(new TestCommand()),
        definedReturnsValueHandler.messageHandler(
          TestDefinedCommand({ orderId: 'a', placedAt: new Date(1) })
        )
      ]
    })

    it('should type check and keep the return type when called directly', () => {
      const [name, orderId] = results as [string, string]
      expect(name).toEqual(TestCommand.NAME)
      expect(orderId).toEqual('a')
    })
  })

  describe('when typed with its attributes', () => {
    let results: unknown[]

    beforeAll(async () => {
      results = [
        await tenantHandler.messageHandler(
          new TestCommand(),
          messageAttributes({ attributes: { tenantId: 'tenant' } }),
          context
        ),
        await definedTenantHandler.messageHandler(
          TestDefinedCommand({ orderId: 'a', placedAt: new Date(1) }),
          messageAttributes({ attributes: { tenantId: 'tenant' } }),
          context
        )
      ]
    })

    it('should pass the typed attributes to a handler for a message class', () => {
      expect(results[0]).toEqual(['tenant', 'tenant'])
    })

    it('should pass the typed attributes to a handler for a defined message', () => {
      expect(results[1]).toEqual('a:tenant:undefined')
    })
  })

  describe('when typed with its attributes and called without them', () => {
    let result: unknown

    beforeAll(async () => {
      result = await tenantHandler.messageHandler(
        new TestCommand(),
        // @ts-expect-error the handler needs a tenantId attribute
        messageAttributes(),
        context
      )
    })

    it('should not type check', () => {
      expect(result).toEqual([undefined, undefined])
    })
  })

  describe('when given a class handler with an explicit message type', () => {
    it('should type check and keep the class', () => {
      expect(explicitClassHandler.messageHandler).toBe(
        TestCommandContextClassHandler
      )
    })
  })

  describe('when the handler declares only the message', () => {
    let result: number

    beforeAll(() => {
      result = messageOnlyHandler.messageHandler(new TestCommand())
    })

    it('should be callable with just the message', () => {
      expect(result).toEqual(1)
    })
  })
})
