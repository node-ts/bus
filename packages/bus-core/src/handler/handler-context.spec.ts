import { Command, Event, MessageAttributes } from '@node-ts/bus-messages'
import {
  TestCommand,
  TestCommand2,
  TestCommandContextClassHandler,
  testCommandContextHandler,
  TestEvent
} from '../test'
import { HandlerContext } from './handler-context'

/**
 * A plain object context that records what's sent and published, with no bus or mocking framework
 */
const createFakeContext = (correlationId: string) => {
  const sent: Command[] = []
  const published: Event[] = []
  const context: HandlerContext = {
    correlationId,
    send: async command => {
      sent.push(command)
    },
    publish: async event => {
      published.push(event)
    },
    failMessage: async () => undefined,
    returnMessage: async () => undefined
  }
  return { context, sent, published }
}

const attributes: MessageAttributes = {
  correlationId: 'correlation-id',
  attributes: {},
  stickyAttributes: {}
}

describe('HandlerContext', () => {
  describe('when a function handler is called directly with a fake context', () => {
    const { context, published } = createFakeContext('correlation-id')

    beforeAll(async () => {
      await testCommandContextHandler.messageHandler(
        new TestCommand(),
        attributes,
        context
      )
    })

    it('should publish through the context', () => {
      expect(published).toEqual([new TestEvent('correlation-id')])
    })
  })

  describe('when a class handler is called directly with a fake context', () => {
    const { context, published } = createFakeContext('correlation-id')

    beforeAll(async () => {
      const sut = new TestCommandContextClassHandler()
      await sut.handle(new TestCommand2(), attributes, context)
    })

    it('should publish through the context', () => {
      expect(published).toEqual([new TestEvent('from-class-handler')])
    })
  })
})
