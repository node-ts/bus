import { IMock, It, Mock, Times } from 'typemoq'
import { HandlesProxy } from './handles-proxy'
import { Persistence } from '../persistence'
import { Logger } from '@node-ts/logger-core'
import { TestCommand, TestWorkflowData } from '../../test'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import * as uuid from 'uuid'
import { WorkflowStatus } from '../workflow-data'
import { MessageAttributes } from '@node-ts/bus-core';

describe('HandlesProxy', () => {
  let persistence: IMock<Persistence>
  let handler: IMock<WorkflowHandlerFn<TestCommand, TestWorkflowData>>
  let sut: HandlesProxy<TestCommand, TestWorkflowData>
  const mapping = new MessageWorkflowMapping<TestCommand, TestWorkflowData>(
    message => message.property1,
    'property1'
  )

  beforeEach(() => {
    persistence = Mock.ofType<Persistence>()

    handler = Mock.ofType<WorkflowHandlerFn<TestCommand, TestWorkflowData>>()
    handler.setup(x => x.name).returns(() => 'handler-name')

    sut = new HandlesProxy<TestCommand, TestWorkflowData>(
      handler.object,
      TestWorkflowData,
      mapping,
      persistence.object,
      Mock.ofType<Logger>().object
    )
  })

  describe('when handling a message', () => {
    let command: TestCommand
    let messageOptions: MessageAttributes
    let dataInput: TestWorkflowData
    let dataOutput: Partial<TestWorkflowData>

    beforeEach(async () => {
      command = new TestCommand('value')
      messageOptions = new MessageAttributes()

      dataInput = new TestWorkflowData()
      dataInput.$workflowId = uuid.v4()
      dataInput.$status = WorkflowStatus.Running

      persistence
        .setup(async x => x.getWorkflowData(
            TestWorkflowData,
            mapping,
            command,
            messageOptions
          )
        )
        .returns(async () => [dataInput])

      dataOutput = { property1: command.property1! }
      handler
        .setup(x => x(command, It.isObjectWith({...dataInput}), messageOptions))
        .returns(async () => dataOutput)
        .verifiable(Times.once())

      await sut.handle(command, messageOptions)
    })

    it('should get workflow data from persistence', () => {
      persistence.verify(
        async x => x.getWorkflowData(TestWorkflowData, mapping, command, messageOptions),
        Times.once()
      )
    })

    it('should call handler with captured message and data from persistence', () => {
      handler.verifyAll()
    })

    it('should save workflow data to persistence', () => {
      persistence.verify(
        async x => x.saveWorkflowData(It.isObjectWith({...dataOutput})),
        Times.once()
      )
    })

    it('should save a strongly-typed workflow data', () => {
      persistence.verify(
        // tslint:disable-next-line:no-any
        async x => x.saveWorkflowData(It.isAny()),
        Times.once()
      )
    })
  })

  describe('when getting workflow data for an undefined message property', () => {
    let comand: TestCommand
    const messageOptions = new MessageAttributes()

    beforeEach(() => {
      comand = new TestCommand(undefined)
    })

    it('should return an empty set of workflow data', async () => {
      const result = await sut.getWorkflowData(comand, messageOptions)
      expect(result).toHaveLength(0)
    })
  })
})
