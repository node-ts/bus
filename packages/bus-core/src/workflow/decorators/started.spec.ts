// tslint:disable:max-classes-per-file variable-name no-console
import * as uuid from 'uuid'
import { completeWorkflow, Workflow } from '../workflow'
import { Bus } from '../../service-bus'
import { Event, Command, MessageAttributes } from '@node-ts/bus-messages'
import { InMemoryPersistence } from '../persistence'
import { Logger } from '@node-ts/logger-core'
import { Mock } from 'typemoq'
import { WorkflowStatus } from '../workflow-data'
import { WorkflowData } from '../workflow-data'
import { sleep } from '../../util'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { getPersistence } from '../persistence/persistence'

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
    readonly assignmentId: string,
    readonly assigneeId: string
  ) {
    super()
  }
}

class CreateAssignmentBundle extends Command {
  $name = 'my-app/accounts/create-assignment-bundle'
  $version = 1

  constructor (
    readonly assignmentId: string,
    readonly bundleId: string
  ) {
    super()
  }
}

class NotifyAssignmentAssigned extends Command {
  $name = 'my-app/accounts/notify-assignment-assigned'
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

class NotifyUnassignedAssignmentReassigned extends Command {
  $name = 'my-app/accounts/notify-unassigned-assignment-reassigned'
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

export class AssignmentWorkflowState extends WorkflowData {
  $name = 'assignment-workflow-state'
  assignmentId: string
  bundleId: string
  assigneeId: string
}

interface AssignmentWorkflowDependencies {
  bus: Bus
  logger: Logger
}

export const assignmentWorkflow = Workflow
  .configure('assignment', AssignmentWorkflowState)
  .startedBy(
    AssignmentCreated,
    ({ message }) => ({ assignmentId: message.assignmentId })
  )
    .when(
      AssignmentAssigned,
      {
        lookup: e => e.assignmentId,
        mapsTo: 'assignmentId'
      },
      async ({ message }) => {
        const bundleId = uuid.v4()
        const createAssignmentBundle = new CreateAssignmentBundle(
          message.assignmentId,
          bundleId
        )
        await Bus.send(createAssignmentBundle)
        return { bundleId, assigneeId: message.assigneeId }
      }
    )
    .when(
      AssignmentReassigned,
      {
        lookup: (_, messageAttributes) => messageAttributes.correlationId,
        mapsTo: '$workflowId'
      },
      async ({ message, workflowState }) => {
        const notifyAssignmentAssigned = new NotifyAssignmentAssigned(workflowState.assignmentId)
        await Bus.send(notifyAssignmentAssigned)

        const notifyAssignmentReassigned = new NotifyUnassignedAssignmentReassigned(
          workflowState.assignmentId,
          message.unassignedUserId
        )
        await Bus.send(notifyAssignmentReassigned)
      }
    )
    .when(
      AssignmentCompleted,
      {
        lookup: e => e.assignmentId,
        mapsTo: 'assignmentId'
      },
      async () => completeWorkflow()
    )

describe('Workflow', () => {
  const event = new AssignmentCreated('abc')

  let bus: Bus
  const CONSUME_TIMEOUT = 500

  beforeAll(async () => {
    const inMemoryPersistence = new InMemoryPersistence()
    await Bus
      .configure()
      .withLogger(Mock.ofType<Logger>().object)
      .withPersistence(inMemoryPersistence)
      .withWorkflow(assignmentWorkflow)
      .initialize()

    await Bus.send(event)
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await Bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    const propertyMapping: MessageWorkflowMapping<AssignmentCreated, AssignmentWorkflowState & WorkflowData> = {
      lookupMessage: e => e.assignmentId,
      workflowDataProperty: 'assignmentId'
    }
    const messageOptions = new MessageAttributes()
    class AssignmentWorkflowData implements AssignmentWorkflowState {
      $workflowId: string
      $name = 'assignment'
      $status: WorkflowStatus
      $version: number

      assignmentId: string
      assigneeId: string
      bundleId: string
    }
    let workflowData: AssignmentWorkflowData[]

    beforeAll(async () => {
      workflowData = await getPersistence().getWorkflowData<AssignmentWorkflowData, AssignmentCreated>(
        AssignmentWorkflowData,
        propertyMapping,
        event,
        messageOptions
      )
    })

    fit('should start a new workflow', () => {
      expect(workflowData).toHaveLength(1)
      const data = workflowData[0]
      expect(data).toMatchObject({ assignmentId: event.assignmentId, $version: 0 })
    })

    xdescribe('and then a message for the next step is received', () => {
      const assignmentAssigned = new AssignmentAssigned(event.assignmentId, uuid.v4())
      let startedWorkflowData: AssignmentWorkflowData[]

      beforeAll(async () => {
        await Bus.publish(assignmentAssigned)
        await sleep(CONSUME_TIMEOUT)

        startedWorkflowData = await getPersistence().getWorkflowData(
          AssignmentWorkflowData,
          propertyMapping,
          assignmentAssigned,
          messageOptions,
          true
        )
      })

      it('should handle that message', () => {
        expect(startedWorkflowData).toHaveLength(1)
        const [data] = startedWorkflowData
        expect(data.assigneeId).toEqual(assignmentAssigned.assigneeId)
      })

      describe('and then a message for the next step is received', () => {
        const assignmentReassigned = new AssignmentReassigned('foo', 'bar')
        let nextWorkflowData: AssignmentWorkflowData[]

        beforeAll(async () => {
          await Bus.publish(
            assignmentReassigned,
            new MessageAttributes({
              correlationId: startedWorkflowData[0].$workflowId
            })
          )
          await sleep(CONSUME_TIMEOUT)

          nextWorkflowData = await getPersistence().getWorkflowData(
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
            await Bus.publish(
              finalTask,
              new MessageAttributes({ correlationId: nextWorkflowData[0].$workflowId })
            )
            await sleep(CONSUME_TIMEOUT)

            finalWorkflowData = await getPersistence().getWorkflowData(
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
