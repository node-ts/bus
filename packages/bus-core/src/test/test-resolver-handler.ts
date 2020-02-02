// tslint:disable: max-classes-per-file
import { HandlesMessage } from '../handler/handles-message'
import { MessageLogger, MESSAGE_LOGGER } from './test-event-handler'
import { inject } from 'inversify'
import { MessageAttributes } from '@node-ts/bus-messages'

const eventType = 's3:objectCreated'

export class SystemEvent {
  constructor (
    readonly type = eventType
  ) {
  }
}

@HandlesMessage((e: SystemEvent) => e.type === eventType)
export class TestResolverHandler {
  constructor (
    @inject(MESSAGE_LOGGER) private readonly messageLogger: MessageLogger
  ) {
  }

  async handle (event: SystemEvent, attributes: MessageAttributes): Promise<void> {
    this.messageLogger.log(event)
    this.messageLogger.log(attributes)
  }
}
