// tslint:disable:no-any no-console

import { ClassConstructor } from '@node-ts/bus-core'
import { Message } from '@node-ts/bus-messages'
import { WorkflowStartedByMetadata } from './started-by'

export function Started<MessageConstructor extends ClassConstructor<Message>> (
  messageConstructor: MessageConstructor
): (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) => void {
  return (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) => {
    WorkflowStartedByMetadata.addStep({
        propertyKey,
        messageConstructor
      },
      target
    )
    console.log('started', messageConstructor, target, propertyKey, descriptor)
  }
}
