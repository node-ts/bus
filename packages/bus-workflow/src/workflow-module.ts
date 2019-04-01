import { ContainerModule } from 'inversify'
import { WORKFLOW_SYMBOLS, WORKFLOW_INTERNAL_SYMBOLS } from './workflow-symbols'
import { InMemoryPersistence, Persistence } from './workflow/persistence'
import { WorkflowRegistry } from './workflow/registry/workflow-registry'
import { HandlesProxy } from './workflow/registry/handles-proxy'
import { StartedByProxy } from './workflow/registry/started-by-proxy'
import { Message } from '@node-ts/bus-messages'
import { WorkflowData, WorkflowDataConstructor } from './workflow'
import { WorkflowHandlerFn } from './workflow/registry/workflow-handler-fn'
import { LOGGER_SYMBOLS, LoggerFactory, bindLogger } from '@node-ts/logger-core'
import { MessageWorkflowMapping } from './workflow/message-workflow-mapping'

export class WorkflowModule extends ContainerModule {
  constructor () {
    super (bind => {
      bind(WORKFLOW_SYMBOLS.Persistence).to(InMemoryPersistence).inSingletonScope()
      bindLogger(bind, InMemoryPersistence)

      bind(WORKFLOW_SYMBOLS.WorkflowRegistry).to(WorkflowRegistry).inSingletonScope()

      bind<StartedByProxy<Message, WorkflowData>>(WORKFLOW_INTERNAL_SYMBOLS.StartedByProxy)
        .toFactory(context => {
          return (
            workflowDataConstructor: WorkflowDataConstructor<WorkflowData>,
            handler: WorkflowHandlerFn<Message, WorkflowData>
          ) => {
            return new StartedByProxy(
              workflowDataConstructor,
              handler,
              context.container.get<Persistence>(WORKFLOW_SYMBOLS.Persistence),
              context.container.get<LoggerFactory>(LOGGER_SYMBOLS.LoggerFactory)
                .build(StartedByProxy.name, context.container)
            )
          }
        })

      bind<HandlesProxy<Message, WorkflowData>>(WORKFLOW_INTERNAL_SYMBOLS.HandlesProxy)
        .toFactory(context => {
          return (
            handler: WorkflowHandlerFn<Message, WorkflowData>,
            workflowDataConstructor: WorkflowDataConstructor<WorkflowData>,
            messageMapper: MessageWorkflowMapping<Message, WorkflowData>
          ) => {
            return new HandlesProxy(
              handler,
              workflowDataConstructor,
              messageMapper,
              context.container.get<Persistence>(WORKFLOW_SYMBOLS.Persistence),
              context.container.get<LoggerFactory>(LOGGER_SYMBOLS.LoggerFactory)
                .build(HandlesProxy.name, context.container)
            )
          }
        })
    })
  }
}
