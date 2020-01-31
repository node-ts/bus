// import { HandlesRawMessage } from '@node-ts/bus-core'
import { HandlesRawMessage } from '../../bus-core/src/handler/handles-message'
import { inject } from 'inversify'
import { BounceEvent } from './bounce-event'

export const BOUNCE_EVENT_HANDLE_CHECKER = Symbol.for('node-ts/bus-sqs/integration/bounce-event-handle-checker')
export interface BounceEventHandleChecker {
  check (event: BounceEvent): void
}

@HandlesRawMessage(BounceEvent)
export class BounceEventHandler {

  constructor (
    @inject(BOUNCE_EVENT_HANDLE_CHECKER)
      private readonly handleChecker: BounceEventHandleChecker
  ) {
  }

  async handle (
    event: BounceEvent
  ): Promise<void> {
    this.handleChecker.check(event)
  }
}
