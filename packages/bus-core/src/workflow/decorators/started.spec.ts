// tslint:disable:max-classes-per-file variable-name no-console
import * as uuid from 'uuid'
import { completeWorkflow, Workflow } from '../workflow'
import { Bus } from '../../service-bus'
import { Event, Command, MessageAttributes } from '@node-ts/bus-messages'
import { InMemoryPersistence } from '../persistence'
import { WorkflowStatus } from '../workflow-state'
import { WorkflowState } from '../workflow-state'
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

export class AssignmentWorkflowState extends WorkflowState {
  $name = 'assignment-workflow-state'
  assignmentId: string
  bundleId: string
  assigneeId: string
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
      lookup: ({ message }) => message.assignmentId,
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
      lookup: ({ attributes: { correlationId }}) => correlationId,
      mapsTo: '$workflowId'
    },
    async ({ message, state: workflowState }) => {
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
      lookup: ({ message }) => message.assignmentId,
      mapsTo: 'assignmentId'
    },
    async () => completeWorkflow()
  )

describe('Workflow', () => {
  const event = new AssignmentCreated('abc')

  const CONSUME_TIMEOUT = 500

  beforeAll(async () => {
    const inMemoryPersistence = new InMemoryPersistence()
    await Bus
      .configure()
      .withPersistence(inMemoryPersistence)
      .withWorkflow(assignmentWorkflow)
      .initialize()

    await Bus.send(event)
    await Bus.start()
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await Bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    const propertyMapping: MessageWorkflowMapping<AssignmentCreated, AssignmentWorkflowState & WorkflowState> = {
      lookup: ({ message }) => message.assignmentId,
      mapsTo: 'assignmentId'
    }
    const messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }
    let workflowState: AssignmentWorkflowState[]

    beforeAll(async () => {
      workflowState = await getPersistence()
        .getWorkflowState<AssignmentWorkflowState, AssignmentCreated>(
          AssignmentWorkflowState,
          propertyMapping,
          event,
          messageOptions
        )
    })

    it('should start a new workflow', () => {
      expect(workflowState).toHaveLength(1)
      const data = workflowState[0]
      expect(data).toMatchObject({ assignmentId: event.assignmentId, $version: 0 })
    })

    describe('and then a message for the next step is received', () => {
      const assignmentAssigned = new AssignmentAssigned(event.assignmentId, uuid.v4())
      let startedWorkflowState: AssignmentWorkflowState[]

      beforeAll(async () => {
        await Bus.publish(assignmentAssigned)
        await sleep(CONSUME_TIMEOUT)

        startedWorkflowState = await getPersistence().getWorkflowState(
          AssignmentWorkflowState,
          propertyMapping,
          assignmentAssigned,
          messageOptions,
          true
        )
      })

      it('should handle that message', () => {
        expect(startedWorkflowState).toHaveLength(1)
        const [data] = startedWorkflowState
        expect(data.assigneeId).toEqual(assignmentAssigned.assigneeId)
      })

      describe('and then a message for the next step is received', () => {
        const assignmentReassigned = new AssignmentReassigned('foo', 'bar')
        let nextWorkflowState: AssignmentWorkflowState[]

        beforeAll(async () => {
          await Bus.publish(
            assignmentReassigned,
            {
              correlationId: startedWorkflowState[0].$workflowId
            }
          )
          await sleep(CONSUME_TIMEOUT)

          nextWorkflowState = await getPersistence().getWorkflowState(
            AssignmentWorkflowState,
            propertyMapping,
            assignmentAssigned,
            messageOptions,
            true
          )
        })

        it('should handle that message', () => {
          expect(nextWorkflowState).toHaveLength(1)
        })

        describe('and then a final message arrives', () => {
          const finalTask = new AssignmentCompleted(event.assignmentId)
          let finalWorkflowState: AssignmentWorkflowState[]

          beforeAll(async () => {
            await Bus.publish(
              finalTask,
              { correlationId: nextWorkflowState[0].$workflowId }
            )
            await sleep(CONSUME_TIMEOUT)

            finalWorkflowState = await getPersistence().getWorkflowState(
              AssignmentWorkflowState,
              propertyMapping,
              finalTask,
              messageOptions,
              true
            )
          })

          it('should mark the workflow as complete', () => {
            expect(finalWorkflowState).toHaveLength(1)
            const data = finalWorkflowState[0]
            expect(data.$status).toEqual(WorkflowStatus.Complete)
          })
        })
      })
    })
  })
})
