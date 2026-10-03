import {
  Message,
  MessageAttributes,
  messageAttributes
} from '@node-ts/bus-messages'
import debug from 'debug'
import { EventEmitter, once } from 'node:events'
import { It, Mock } from 'typemoq'
import { DebugLogger, Logger } from '../logger'
import { Bus, BusInstance } from '../service-bus'
import { messageTypesFor, testMessageTypes } from '../test'
import { ClassConstructor, sleep } from '../util'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { InMemoryPersistence } from './persistence'
import { TaskRan, TestCommand, TestWorkflow, TestWorkflowState } from './test'
import {
  ContinueTestFailingWorkflow,
  ContinueTestFunctionFailingWorkflow,
  StartTestFailingWorkflow,
  StartTestFunctionFailingWorkflow,
  TestFailingWorkflow,
  TestFailingWorkflowState,
  testFunctionFailingWorkflow,
  TestFunctionFailingWorkflowState
} from './test/test-failing-workflow'
import {
  TestWorkflowStartedByCompletes,
  TestWorkflowStartedByCompletesData
} from './test/test-workflow-startedby-completes'
import {
  TestWorkflowStartedByDiscard,
  TestWorkflowStartedByDiscardData
} from './test/test-workflow-startedby-discard'
import { WorkflowState, WorkflowStatus } from './workflow-state'

describe('Workflow', () => {
  const command = new TestCommand('abc')
  const CONSUME_TIMEOUT = 2000
  let bus: BusInstance
  const inMemoryPersistence = new InMemoryPersistence()

  beforeAll(async () => {
    bus = Bus.configure()
      .withMessageTypes(testMessageTypes)
      .withPersistence(inMemoryPersistence)
      .withContainer({
        get<T>(workflowType: ClassConstructor<T>) {
          return new workflowType(bus)
        }
      })
      .withWorkflow(TestWorkflow)
      .withWorkflow(TestWorkflowStartedByCompletes)
      .withWorkflow(TestWorkflowStartedByDiscard)
      .build()

    await bus.initialize()
    await bus.start()
    await bus.send(command)
    await sleep(CONSUME_TIMEOUT)
  })

  afterAll(async () => {
    await bus.dispose()
  })

  describe('when a message that starts a workflow is received', () => {
    const propertyMapping: MessageWorkflowMapping<
      TestCommand,
      TestWorkflowState
    > = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }
    let workflowState: TestWorkflowState[]
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }

    beforeAll(async () => {
      workflowState = await inMemoryPersistence.getWorkflowState<
        TestWorkflowState,
        TestCommand
      >(TestWorkflowState, propertyMapping, command, messageOptions)
    })

    it('should start a new workflow', () => {
      expect(workflowState).toHaveLength(1)
      const data = workflowState[0]
      expect(data.$status).toEqual(WorkflowStatus.Running)
      expect(data.$version).toEqual(1)
      expect(data).toMatchObject({ property1: command.property1 })
    })

    describe('and then a message for the next step is received', () => {
      const event = new TaskRan('abc')
      let nextWorkflowState: TestWorkflowState[]

      beforeAll(async () => {
        await bus.publish(event)
        await sleep(CONSUME_TIMEOUT)

        nextWorkflowState = await inMemoryPersistence.getWorkflowState<
          TestWorkflowState,
          TestCommand
        >(TestWorkflowState, propertyMapping, command, messageOptions, true)
      })

      it('should handle that message', () => {
        expect(nextWorkflowState).toHaveLength(1)
      })

      // step2 sends FinalTask from inside the workflow, so it carries the workflow id in its sticky
      // attributes and is routed back to this workflow instance
      describe('and then the final message sent by the workflow is handled', () => {
        let finalWorkflowState: TestWorkflowState[]

        beforeAll(async () => {
          finalWorkflowState = await inMemoryPersistence.getWorkflowState<
            TestWorkflowState,
            TestCommand
          >(TestWorkflowState, propertyMapping, command, messageOptions, true)
        })

        it('should mark the workflow as complete', () => {
          expect(finalWorkflowState).toHaveLength(1)
          const data = finalWorkflowState[0]
          expect(data.$status).toEqual(WorkflowStatus.Complete)
        })
      })
    })
  })

  describe('when a workflow is completed in a StartedBy handler', () => {
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }
    const propertyMapping: MessageWorkflowMapping<
      TestCommand,
      TestWorkflowStartedByCompletesData
    > = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }

    it('should persist the workflow as completed', async () => {
      const workflowState = await inMemoryPersistence.getWorkflowState<
        TestWorkflowStartedByCompletesData,
        TestCommand
      >(
        TestWorkflowStartedByCompletesData,
        propertyMapping,
        command,
        messageOptions,
        true
      )
      expect(workflowState).toHaveLength(1)

      const data = workflowState[0]
      expect(data.$status).toEqual(WorkflowStatus.Complete)
    })
  })

  describe('when a StartedBy handler returns undefined', () => {
    const messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    }
    const propertyMapping: MessageWorkflowMapping<
      TestCommand,
      TestWorkflowStartedByDiscardData
    > = {
      lookup: message => message.property1,
      mapsTo: 'property1'
    }

    it('should not persist the workflow', async () => {
      const workflowState = await inMemoryPersistence.getWorkflowState<
        TestWorkflowStartedByDiscardData,
        TestCommand
      >(
        TestWorkflowStartedByDiscardData,
        propertyMapping,
        command,
        messageOptions,
        true
      )

      expect(workflowState).toHaveLength(0)
    })
  })

  describe('when a workflow handler throws', () => {
    const FAILURE_LOG =
      'Message was unsuccessfully handled. Returning to queue.'
    const persistence = new InMemoryPersistence()
    // Emits each failure the bus logs, by the name of the message that failed
    const failureLogs = new EventEmitter()
    const loggedFailures: FailureLog[] = []
    let failingBus: BusInstance

    beforeAll(async () => {
      const logger = Mock.ofType<Logger>()
      logger
        .setup(l => l.error(It.isAnyString(), It.isAny()))
        .callback((message: string, meta: FailureLog) => {
          if (message === FAILURE_LOG) {
            loggedFailures.push(meta)
            failureLogs.emit(meta.busMessage.domainMessage.$name, meta)
          }
        })

      failingBus = Bus.configure()
        .withLogger(() => logger.object)
        .withMessageTypes(
          messageTypesFor(
            StartTestFailingWorkflow,
            ContinueTestFailingWorkflow,
            StartTestFunctionFailingWorkflow,
            ContinueTestFunctionFailingWorkflow,
            TestFailingWorkflowState,
            TestFunctionFailingWorkflowState
          )
        )
        .withPersistence(persistence)
        // Keeps the failed message from being retried before the bus is disposed
        .withRetryStrategy({ calculateRetryDelay: () => 60_000 })
        .withWorkflow(TestFailingWorkflow, testFunctionFailingWorkflow)
        .build()
      await failingBus.initialize()
      await failingBus.start()
    })

    afterAll(async () => {
      await failingBus.dispose()
    })

    describe.each([
      {
        description: 'a class workflow startedBy',
        workflowName: TestFailingWorkflow.name,
        stateType: TestFailingWorkflowState,
        start: undefined,
        failing: StartTestFailingWorkflow({ key: 'class-start', fail: true }),
        cause: 'class startedBy failed for class-start'
      },
      {
        description: 'a class workflow when',
        workflowName: TestFailingWorkflow.name,
        stateType: TestFailingWorkflowState,
        start: StartTestFailingWorkflow({ key: 'class-when', fail: false }),
        failing: ContinueTestFailingWorkflow({ key: 'class-when' }),
        cause: 'class when failed for class-when'
      },
      {
        description: 'a defineWorkflow startedBy',
        workflowName: TestFunctionFailingWorkflowState.NAME,
        stateType: TestFunctionFailingWorkflowState,
        start: undefined,
        failing: StartTestFunctionFailingWorkflow({
          key: 'function-start',
          fail: true
        }),
        cause: 'function startedBy failed for function-start'
      },
      {
        description: 'a defineWorkflow when',
        workflowName: TestFunctionFailingWorkflowState.NAME,
        stateType: TestFunctionFailingWorkflowState,
        start: StartTestFunctionFailingWorkflow({
          key: 'function-when',
          fail: false
        }),
        failing: ContinueTestFunctionFailingWorkflow({ key: 'function-when' }),
        cause: 'function when failed for function-when'
      }
    ])(
      'with $description handler',
      ({ workflowName, stateType, start, failing, cause }) => {
        let failures: FailureLog[]
        let rejection: SerializedWorkflowHandlerFailed
        let startedWorkflowId: string | undefined

        beforeAll(async () => {
          const failureLogged = once(failureLogs, failing.$name)
          if (start) {
            // The bus handles one message at a time, so the workflow is started before the failing message is read
            await failingBus.send(start)
          }
          await failingBus.send(failing)
          await failureLogged

          failures = loggedFailures.filter(
            failure => failure.busMessage.domainMessage.$name === failing.$name
          )
          rejection = failures[0].error.rejections[0]
          const [startedState] = await persistence.getWorkflowState<
            WorkflowState & { key: string },
            Message & { key: string }
          >(
            stateType,
            { lookup: message => message.key, mapsTo: 'key' },
            failing,
            messageAttributes(),
            true
          )
          startedWorkflowId = startedState?.$workflowId
        })

        it('should log the failure once', () => {
          expect(failures).toHaveLength(1)
        })

        it('should name the workflow, the instance and the message in the logged error', () => {
          expect(failures[0].error.message).toContain(
            `Workflow ${workflowName} failed handling ${failing.$name} for workflow id ${rejection.workflowId}: Error: ${cause}`
          )
          expect(rejection).toMatchObject({
            workflowName,
            messageName: failing.$name
          })
        })

        it('should name the instance that failed', () => {
          if (start) {
            expect(rejection.workflowId).toEqual(startedWorkflowId)
          } else {
            // A failed startedBy handler's instance is never saved
            expect(startedWorkflowId).toBeUndefined()
            expect(rejection.workflowId).toEqual(expect.any(String))
          }
        })

        it('should log the thrown error as the cause', () => {
          expect(rejection.cause.message).toEqual(cause)
          expect(rejection.cause.stack).toContain(cause)
        })

        it('should not wrap the failure twice', () => {
          expect(
            failures[0].error.message.match(/Message handling failed/g)
          ).toHaveLength(1)
        })
      }
    )

    describe('with a when handler that fails for several instances', () => {
      const failing = ContinueTestFailingWorkflow({ key: 'class-several' })
      let instanceFailures: SerializedWorkflowHandlerFailed[]

      beforeAll(async () => {
        const failureLogged = once(failureLogs, failing.$name)
        const start = StartTestFailingWorkflow({
          key: 'class-several',
          fail: false
        })
        await failingBus.send(start)
        await failingBus.send(start)
        await failingBus.send(failing)
        const [failure] = (await failureLogged) as [
          { error: { rejections: { rejections: unknown[] }[] } }
        ]
        instanceFailures = failure.error.rejections[0]
          .rejections as SerializedWorkflowHandlerFailed[]
      })

      it('should list a failure for each instance', () => {
        expect(instanceFailures).toHaveLength(2)
        expect(
          new Set(instanceFailures.map(failure => failure.workflowId)).size
        ).toEqual(2)
        instanceFailures.forEach(failure =>
          expect(failure.cause.message).toEqual(
            'class when failed for class-several'
          )
        )
      })
    })

    // The reported bug: with the default logger and no DEBUG set, a failing workflow wrote nothing
    describe('and the bus logs with DebugLogger without DEBUG enabled', () => {
      const failing = StartTestFunctionFailingWorkflow({
        key: 'debug-logger',
        fail: true
      })
      const consoleLines = new EventEmitter()
      let debugLoggerBus: BusInstance
      let line: string
      let meta: FailureLog

      beforeAll(async () => {
        debug.disable()
        const consoleOutput = Mock.ofType<Pick<Console, 'warn' | 'error'>>()
        consoleOutput
          .setup(c => c.error(It.isAnyString(), It.isAny()))
          .callback((logged: string, loggedMeta: FailureLog) => {
            if (logged.endsWith(FAILURE_LOG)) {
              consoleLines.emit('failure', logged, loggedMeta)
            }
          })

        debugLoggerBus = Bus.configure()
          .withLogger(name => new DebugLogger(name, consoleOutput.object))
          .withMessageTypes(
            messageTypesFor(
              StartTestFunctionFailingWorkflow,
              ContinueTestFunctionFailingWorkflow,
              TestFunctionFailingWorkflowState
            )
          )
          .withPersistence(new InMemoryPersistence())
          .withRetryStrategy({ calculateRetryDelay: () => 60_000 })
          .withWorkflow(testFunctionFailingWorkflow)
          .build()
        await debugLoggerBus.initialize()
        await debugLoggerBus.start()

        const failureWritten = once(consoleLines, 'failure')
        await debugLoggerBus.send(failing)
        ;[line, meta] = (await failureWritten) as [string, FailureLog]
      })

      afterAll(async () => {
        await debugLoggerBus.dispose()
      })

      it('should write the failure to console.error with the workflow and the original error', () => {
        expect(line).toEqual(`@node-ts/bus-core:service-bus ${FAILURE_LOG}`)
        expect(meta.error.message).toContain(
          `Workflow ${TestFunctionFailingWorkflowState.NAME} failed handling ${failing.$name}`
        )
        expect(meta.error.message).toContain(
          'function startedBy failed for debug-logger'
        )
      })
    })
  })
})

/**
 * What `serializeError` makes of a `WorkflowHandlerFailed`
 */
interface SerializedWorkflowHandlerFailed {
  workflowName: string
  workflowId: string
  messageName: string
  cause: { message: string; stack: string }
}

/**
 * The context the bus logs a failed message with
 */
interface FailureLog {
  busMessage: { domainMessage: { $name: string } }
  error: { message: string; rejections: SerializedWorkflowHandlerFailed[] }
}
