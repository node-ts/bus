import * as uuid from 'uuid'
import { Workflow, WorkflowMapper } from './workflow'
import { Bus, BusInstance } from '../service-bus'
import { Event, Command, MessageAttributes } from '@node-ts/bus-messages'
import { InMemoryPersistence } from './persistence'
import { WorkflowStatus } from './workflow-state'
import { WorkflowState } from './workflow-state'
import { sleep } from '../util'
import { MessageWorkflowMapping } from './message-workflow-mapping'

class AssignmentCreated extends Event {
  $name = 'my-app/accounts/assignment-created'
  $version = 1

  constructor(readonly assignmentId: string) {
    super()
  }
}

class AssignmentAssigned extends Event {
  $name = 'my-app/accounts/assignment-assigned'
  $version = 1

  constructor(readonly assignmentId: string, readonly assigneeId: string) {
    super()
  }
}

class CreateAssignmentBundle extends Command {
  $name = 'my-app/accounts/create-assignment-bundle'
  $version = 1

  constructor(readonly assignmentId: string, readonly bundleId: string) {
    super()
  }
}

class NotifyAssignmentAssigned extends Command {
  $name = 'my-app/accounts/notify-assignment-assigned'
  $version = 1

  constructor(readonly assignmentId: string) {
    super()
  }
}

class AssignmentReassigned extends Event {
  $name = 'my-app/accounts/assignment-reassigned'
  $version = 1

  constructor(
    readonly assignmentId: string,
    readonly unassignedUserId: string
  ) {
    super()
  }
}

class NotifyUnassignedAssignmentReassigned extends Command {
  $name = 'my-app/accounts/notify-unassigned-assignment-reassigned'
  $version = 1

  constructor(
    readonly assignmentId: string,
    readonly unassignedUserId: string
  ) {
    super()
  }
}

class AssignmentCompleted extends Event {
  $name = 'my-app/accounts/assignment-completed'
  $version = 1

  constructor(readonly assignmentId: string) {
    super()
  }
}

export class AssignmentWorkflowState extends WorkflowState {
  $name = 'assignment-workflow-state'
  assignmentId: string
  bundleId: string
  assigneeId: string
}

class AssignmentWorkflow extends Workflow<AssignmentWorkflowState> {
  constructor(private readonly bus: BusInstance) {
    super()
  }

  configureWorkflow(
    mapper: WorkflowMapper<AssignmentWorkflowState, AssignmentWorkflow>
  ): void {
    mapper
      .withState(AssignmentWorkflowState)
      .startedBy(AssignmentCreated, 'assignmentCreated')
      .when(AssignmentAssigned, 'sendCreateAssignment', {
        lookup: message => message.assignmentId,
        mapsTo: 'assignmentId'
      })
      .when(AssignmentReassigned, 'sendNotification', {
        lookup: (_, { correlationId }) => correlationId,
        mapsTo: '$workflowId'
      })
      .when(AssignmentCompleted, 'complete', {
        lookup: message => message.assignmentId,
        mapsTo: 'assignmentId'
      })
  }

  assignmentCreated(
    message: AssignmentCreated
  ): Partial<AssignmentWorkflowState> {
    return {
      assignmentId: message.assignmentId
    }
  }

  async sendCreateAssignment(
    message: AssignmentAssigned
  ): Promise<Partial<AssignmentWorkflowState>> {
    const bundleId = uuid.v4()
    const createAssignmentBundle = new CreateAssignmentBundle(
      message.assignmentId,
      bundleId
    )
    await this.bus.send(createAssignmentBundle)
    return { bundleId, assigneeId: message.assigneeId }
  }

  async sendNotification(
    message: AssignmentReassigned,
    workflowState: AssignmentWorkflowState
  ): Promise<void> {
    const notifyAssignmentAssigned = new NotifyAssignmentAssigned(
      workflowState.assignmentId
    )
    await this.bus.send(notifyAssignmentAssigned)

    const notifyAssignmentReassigned = new NotifyUnassignedAssignmentReassigned(
      workflowState.assignmentId,
      message.unassignedUserId
    )
    await this.bus.send(notifyAssignmentReassigned)
  }

  complete(): Partial<AssignmentWorkflowState> {
    return this.completeWorkflow()
  }
}

export const assignmentWorkflow = Workflow

describe('Workflow', () => {
  const event = new AssignmentCreated('abc')
  let bus: BusInstance

  const CONSUME_TIMEOUT = 2000
  const inMemoryPersistence = new InMemoryPersistence()

  beforeAll(async () => {
    bus = await Bus.configure()
      .withPersistence(inMemoryPersistence)
      .withContainer({
        get: type => new type(bus)
      })
      .withWorkflow(AssignmentWorkflow)
      .initialize()

    await bus.send(event)
    await bus.start()
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    const propertyMapping: MessageWorkflowMapping<
      AssignmentCreated,
      AssignmentWorkflowState & WorkflowState
    > = {
      lookup: message => message.assignmentId,
      mapsTo: 'assignmentId'
    }
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }
    let workflowState: AssignmentWorkflowState[]

    beforeAll(async () => {
      workflowState = await inMemoryPersistence.getWorkflowState<
        AssignmentWorkflowState,
        AssignmentCreated
      >(AssignmentWorkflowState, propertyMapping, event, messageOptions)
    })

    it('should start a new workflow', () => {
      expect(workflowState).toHaveLength(1)
      const data = workflowState[0]
      expect(data).toMatchObject({
        assignmentId: event.assignmentId,
        $version: 0
      })
    })

    describe('and then a message for the next step is received', () => {
      const assignmentAssigned = new AssignmentAssigned(
        event.assignmentId,
        uuid.v4()
      )
      let startedWorkflowState: AssignmentWorkflowState[]

      beforeAll(async () => {
        await bus.publish(assignmentAssigned)
        await sleep(CONSUME_TIMEOUT)

        startedWorkflowState = await inMemoryPersistence.getWorkflowState(
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
          await bus.publish(assignmentReassigned, {
            correlationId: startedWorkflowState[0].$workflowId
          })
          await sleep(CONSUME_TIMEOUT)

          nextWorkflowState = await inMemoryPersistence.getWorkflowState(
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
            await bus.publish(finalTask, {
              correlationId: nextWorkflowState[0].$workflowId
            })
            await sleep(CONSUME_TIMEOUT)

            finalWorkflowState = await inMemoryPersistence.getWorkflowState(
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
