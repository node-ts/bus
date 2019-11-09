// tslint:disable:max-classes-per-file variable-name no-console
import * as uuid from 'uuid'
import { FnWorkflow, WorkflowState, completeWorkflow } from './fn-workflow'
import { ApplicationBootstrap, Bus, BusModule, BUS_SYMBOLS, sleep } from '@node-ts/bus-core'
import { Event, Command, MessageAttributes } from '@node-ts/bus-messages'
import { Container, inject } from 'inversify'
import { Persistence } from '../persistence'
import { BusWorkflowModule } from '../../bus-workflow-module'
import { LoggerModule, LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { Mock } from 'typemoq'
import { BUS_WORKFLOW_SYMBOLS } from '../../bus-workflow-symbols'
import { WorkflowRegistry } from '../registry/workflow-registry'
import { WorkflowStatus } from '../workflow-data'
import { MessageWorkflowMapping } from '../message-workflow-mapping'


class AssignmentCreated extends Event {
  $name = 'my-app/accounts/assignment-created'
  $version = 1

  constructor (
    readonly assignmentId: string
  ) {
    super()
  }
}

class AssignmentAssigned extends Event {
  $name = 'my-app/accounts/assignment-assigned'
  $version = 1

  constructor (
    readonly assignmentId: string
  ) {
    super()
  }
}

class CreateTranscriptionAssignmentBundle extends Command {
  $name = 'my-app/accounts/create-transcription-assignment-bundle'
  $version = 1

  constructor (
    readonly assignmentId: string,
    readonly bundleId: string
  ) {
    super()
  }
}

class NotifyTranscriberOfAssignmentAssigned extends Command {
  $name = 'my-app/accounts/notify-transcriber-assignment-assigned'
  $version = 1

  constructor (
    readonly assignmentId: string
  ) {
    super()
  }
}

class AssignmentReassigned extends Event {
  $name = 'my-app/accounts/assignment-reassigned'
  $version = 1

  constructor (
    readonly assignmentId: string,
    readonly unassignedUserId: string
  ) {
    super()
  }
}

class NotifyUnassignedTranscriberOfAssignmentReassigned extends Command {
  $name = 'my-app/accounts/notify-unassigned-transcriber-of-assignment-reassigned'
  $version = 1

  constructor (
    readonly assignmentId: string,
    readonly unassignedUserId: string
  ) {
    super()
  }
}

class AssignmentCompleted extends Event {
  $name = 'my-app/accounts/assignment-completed'
  $version = 1

  constructor (
    readonly assignmentId: string
  ) {
    super()
  }
}

interface AssignmentWorkflowState {
  assignmentId: string
  bundleId: string
}

interface AssignmentWorkflowDependencies {
  bus: Bus
  logger: Logger
}

export const assignmentWorkflow = new FnWorkflow<AssignmentWorkflowState,AssignmentWorkflowDependencies>(
  'assignment',
  c => ({
    bus: c.get<Bus>(BUS_SYMBOLS.Bus),
    logger: c.get<Logger>(LOGGER_SYMBOLS.Logger)
  })
)
  .startedBy(
    AssignmentCreated,
    ({ message }) => {
      console.log('Assignment workflow started', message)
      return { assignmentId: message.assignmentId }
    }
  )
    .when(
      AssignmentAssigned,
      async ({ message, dependencies: { bus } }) => {
        const bundleId = uuid.v4()
        const createTranscriptionAssignmentBundle = new CreateTranscriptionAssignmentBundle(message.assignmentId, bundleId)
        await bus.send(createTranscriptionAssignmentBundle)
        console.log('Handled AssignmentAssigned')
        return { bundleId }
      },
      {
        lookup: e => e.assignmentId,
        mapping: 'assignmentId'
      }
    )
    .when(
      AssignmentReassigned,
      async ({ message, state, dependencies: { bus } }) => {
        const notifyTranscriberOfAssignmentAssigned = new NotifyTranscriberOfAssignmentAssigned(state.assignmentId)
        await bus.send(notifyTranscriberOfAssignmentAssigned)

        const notifyTranscriberOfAssignmentReassigned = new NotifyUnassignedTranscriberOfAssignmentReassigned(
          state.assignmentId,
          message.unassignedUserId
        )
        await bus.send(notifyTranscriberOfAssignmentReassigned)
      },
      {
        lookup: e => e.assignmentId,
        mapping: 'assignmentId'
      }
    )
    .when(
      AssignmentCompleted,
      async ({ dependencies: { logger }}) => {

        return completeWorkflow()
      },
      {
        lookup: e => e.assignmentId,
        mapping: 'assignmentId'
      }
    )

describe('Workflow', () => {
  let container: Container
  let persistence: Persistence
  let bootstrap: ApplicationBootstrap
  const event = new AssignmentCreated('abc')

  let bus: Bus
  const CONSUME_TIMEOUT = 500

  beforeAll(async () => {
    container = new Container()
    container.load(new LoggerModule())
    container.load(new BusModule())
    container.load(new BusWorkflowModule())
    container.rebind(LOGGER_SYMBOLS.Logger).toConstantValue(Mock.ofType<Logger>().object)

    persistence = container.get<Persistence>(BUS_WORKFLOW_SYMBOLS.Persistence)

    const workflowRegistry = container.get<WorkflowRegistry>(BUS_WORKFLOW_SYMBOLS.WorkflowRegistry)
    await workflowRegistry.registerFunctional(assignmentWorkflow)
    await workflowRegistry.initializeWorkflows()

    bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await bootstrap.initialize(container)

    bus = container.get(BUS_SYMBOLS.Bus)
    await bus.send(event)
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await bootstrap.dispose()
  })


  describe('when a message that starts a workflow is received', () => {
    const propertyMapping = new MessageWorkflowMapping<AssignmentCreated, AssignmentWorkflowState & WorkflowState> (
      e => e.assignmentId,
      'assignmentId'
    )
    const messageOptions = new MessageAttributes()
    class AssignmentWorkflowData implements AssignmentWorkflowState, WorkflowState {
      $workflowId: string
      $name = 'assignment'
      $status: WorkflowStatus
      $version: number

      assignmentId: string
      bundleId: string
    }
    let workflowData: AssignmentWorkflowData[]

    beforeAll(async () => {
      workflowData = await persistence.getWorkflowData<AssignmentWorkflowData, AssignmentCreated>(
        AssignmentWorkflowData,
        propertyMapping,
        event,
        messageOptions
      )
    })

    it('should start a new workflow', () => {
      expect(workflowData).toHaveLength(1)
      const data = workflowData[0]
      expect(data).toMatchObject({ assignmentId: event.assignmentId })
    })

    describe('and then a message for the next step is received', () => {
      const assignmentAssigned = new AssignmentAssigned(event.assignmentId)
      let nextWorkflowData: AssignmentWorkflowData[]

      beforeAll(async () => {
        await bus.publish(assignmentAssigned)
        await sleep(CONSUME_TIMEOUT)

        nextWorkflowData = await persistence.getWorkflowData(
          AssignmentWorkflowData,
          propertyMapping,
          assignmentAssigned,
          messageOptions,
          true
        )
      })

      it('should handle that message', () => {
        expect(nextWorkflowData).toHaveLength(1)
      })

      describe('and then a message for the next step is received', () => {
        const filesBundled = new AssignmentReassigned(event.assignmentId, 'someone')
        let nextWorkflowData: AssignmentWorkflowData[]

        beforeAll(async () => {
          await bus.publish(filesBundled)
          await sleep(CONSUME_TIMEOUT)

          nextWorkflowData = await persistence.getWorkflowData(
            AssignmentWorkflowData,
            propertyMapping,
            assignmentAssigned,
            messageOptions,
            true
          )
        })

        it('should handle that message', () => {
          expect(nextWorkflowData).toHaveLength(1)
        })

        describe('and then a final message arrives', () => {
          const finalTask = new AssignmentCompleted(event.assignmentId)
          let finalWorkflowData: AssignmentWorkflowData[]

          beforeAll(async () => {
            await bus.publish(
              finalTask,
              new MessageAttributes({ correlationId: nextWorkflowData[0].$workflowId })
            )
            await sleep(CONSUME_TIMEOUT)

            finalWorkflowData = await persistence.getWorkflowData(
              AssignmentWorkflowData,
              propertyMapping,
              finalTask,
              messageOptions,
              true
            )
          })

          it('should mark the workflow as complete', () => {
            expect(finalWorkflowData).toHaveLength(1)
            const data = finalWorkflowData[0]
            expect(data.$status).toEqual(WorkflowStatus.Complete)
          })
        })
      })
    })
  })
})
