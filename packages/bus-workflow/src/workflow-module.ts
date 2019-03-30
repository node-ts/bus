import { ContainerModule } from 'inversify'
import { WORKFLOW_SYMBOLS } from './workflow-symbols'
import { InMemoryPersistence } from './workflow/persistence'

export class WorkflowModule extends ContainerModule {
  constructor () {
    super (bind => {
      bind(WORKFLOW_SYMBOLS.Persistence).to(InMemoryPersistence)
    })
  }
}
