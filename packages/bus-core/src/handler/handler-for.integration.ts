import { MessageAttributes, MessageTypes } from '@node-ts/bus-messages'
import { EventEmitter } from 'node:events'
import { It, Mock, Times } from 'typemoq'
import { Logger } from '../logger'
import { Receiver } from '../receiver'
import { MessageSerializer, MessageTypesMissing } from '../serialization'
import { Bus, BusInstance } from '../service-bus'
import { HandleChecker, TestDefinedCommand, TestDefinedEvent } from '../test'
import { TransportMessage } from '../transport'
import { Workflow, WorkflowMapper, WorkflowState } from '../workflow'
import { handlerFor } from './handler-for'

class TestDefinedMessageWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-defined-message-workflow-state'
  $name = TestDefinedMessageWorkflowState.NAME
  orderId: string
}

/**
 * A message from another system, declared as an interface with a literal $name
 */
interface TestInterfaceMessage {
  $name: '@node-ts/bus-core/test-interface-message'
  $version: 0
  uploadedAt: Date
}

/**
 * Hands JSON payloads straight to the bus' serializer, as a host would
 */
class JsonReceiver implements Receiver<string, TransportMessage<string>> {
  async receive(
    receivedMessage: string,
    messageSerializer: MessageSerializer
  ): Promise<TransportMessage<string>> {
    return {
      id: undefined,
      domainMessage: messageSerializer.deserialize(receivedMessage),
      raw: receivedMessage,
      attributes: { attributes: {}, stickyAttributes: {} }
    }
  }
}

const testMessageTypes: MessageTypes = {
  messages: {
    [TestDefinedCommand.NAME]: 'TestDefinedCommand',
    [TestDefinedEvent.NAME]: 'TestDefinedEvent',
    [TestDefinedMessageWorkflowState.NAME]: 'TestDefinedMessageWorkflowState',
    '@node-ts/bus-core/test-interface-message': 'TestInterfaceMessage'
  },
  types: {
    TestDefinedCommand: { fields: { placedAt: 'Date' } },
    TestDefinedEvent: { fields: {} },
    TestDefinedMessageWorkflowState: {
      class: TestDefinedMessageWorkflowState,
      fields: {}
    },
    TestInterfaceMessage: { fields: { uploadedAt: 'Date' } }
  }
}

describe('handlerFor', () => {
  describe('when handling messages declared with defineCommand and defineEvent', () => {
    const events = new EventEmitter()
    const handleChecker = Mock.ofType<HandleChecker>()
    const workflowChecker = Mock.ofType<HandleChecker>()
    let bus: BusInstance
    let sent: TestDefinedCommand

    class TestDefinedMessageWorkflow extends Workflow<TestDefinedMessageWorkflowState> {
      configureWorkflow(
        mapper: WorkflowMapper<
          TestDefinedMessageWorkflowState,
          TestDefinedMessageWorkflow
        >
      ): void {
        mapper
          .withState(TestDefinedMessageWorkflowState)
          .startedBy(TestDefinedCommand, 'start')
          .when(TestDefinedEvent, 'complete', {
            lookup: event => event.orderId,
            mapsTo: 'orderId'
          })
      }

      start(
        command: TestDefinedCommand
      ): Partial<TestDefinedMessageWorkflowState> {
        events.emit('started')
        return { orderId: command.orderId }
      }

      complete(
        event: TestDefinedEvent,
        _: TestDefinedMessageWorkflowState,
        attributes: MessageAttributes
      ) {
        workflowChecker.object.check(event, attributes)
        events.emit('completed')
        return this.completeWorkflow()
      }
    }

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(testMessageTypes)
        .withHandler(
          handlerFor(TestDefinedCommand, (command, attributes) => {
            handleChecker.object.check(command, attributes)
          })
        )
        .withWorkflow(TestDefinedMessageWorkflow)
        .build()
      await bus.initialize()
      await bus.start()

      sent = TestDefinedCommand({ orderId: 'a', placedAt: new Date(1) })
      const started = new Promise(resolve => events.once('started', resolve))
      await bus.send(sent)
      await started
      const completed = new Promise(resolve =>
        events.once('completed', resolve)
      )
      await bus.publish(TestDefinedEvent({ orderId: 'a' }))
      await completed
    })

    afterAll(async () => bus.dispose())

    it('should create the message with its $name and $version', () => {
      expect(sent).toEqual({
        orderId: 'a',
        placedAt: new Date(1),
        $name: '@node-ts/bus-core/test-defined-command',
        $version: 0
      })
      expect(TestDefinedEvent({ orderId: 'b' }).$version).toEqual(2)
    })

    it('should dispatch it to its handler', () => {
      handleChecker.verify(
        checker =>
          checker.check(
            It.isObjectWith<TestDefinedCommand>({ orderId: 'a' }),
            It.isAny()
          ),
        Times.once()
      )
    })

    it('should start and continue a workflow with it', () => {
      workflowChecker.verify(
        checker =>
          checker.check(
            It.isObjectWith<TestDefinedEvent>({
              $name: TestDefinedEvent.NAME,
              orderId: 'a'
            }),
            It.isAny()
          ),
        Times.once()
      )
    })
  })

  describe('when receiving a message declared with defineCommand as JSON', () => {
    const received: unknown[] = []
    let bus: BusInstance

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes(testMessageTypes)
        .withReceiver(new JsonReceiver())
        .withHandler(
          handlerFor(TestDefinedCommand, command => {
            received.push(command)
          })
        )
        .withCustomHandler(
          (message: TestInterfaceMessage) => {
            received.push(message)
          },
          {
            resolveWith: message =>
              message.$name === '@node-ts/bus-core/test-interface-message'
          }
        )
        .build()
      await bus.initialize()
      await bus.receive(
        JSON.stringify({
          $name: TestDefinedCommand.NAME,
          $version: 0,
          orderId: 'a',
          placedAt: '2020-01-01T00:00:00.000Z'
        })
      )
      await bus.receive(
        JSON.stringify({
          $name: '@node-ts/bus-core/test-interface-message',
          $version: 0,
          uploadedAt: '2020-01-02T00:00:00.000Z'
        })
      )
    })

    afterAll(async () => bus.dispose())

    it('should restore its fields as a plain object', () => {
      const [command] = received as TestDefinedCommand[]
      expect(Object.getPrototypeOf(command)).toBe(Object.prototype)
      expect(command.placedAt).toEqual(new Date('2020-01-01T00:00:00.000Z'))
    })

    it('should restore a message declared as an interface for a custom handler', () => {
      const [, message] = received as [unknown, TestInterfaceMessage]
      expect(message.uploadedAt).toEqual(new Date('2020-01-02T00:00:00.000Z'))
    })
  })

  describe('when initializing with message types that are missing a defined message', () => {
    let bus: BusInstance
    let initializeError: unknown

    beforeAll(async () => {
      bus = Bus.configure()
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMessageTypes({
          messages: { other: 'Other' },
          types: { Other: { fields: {} } }
        })
        .withHandler(handlerFor(TestDefinedCommand, () => undefined))
        .build()
      initializeError = await bus.initialize().then(
        () => undefined,
        (caught: unknown) => caught
      )
    })

    afterAll(async () => bus.dispose())

    it('should throw MessageTypesMissing naming it', () => {
      expect(initializeError).toBeInstanceOf(MessageTypesMissing)
      expect((initializeError as MessageTypesMissing).missingNames).toEqual([
        TestDefinedCommand.NAME
      ])
    })
  })
})
