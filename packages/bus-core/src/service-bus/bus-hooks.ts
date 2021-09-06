import { Command, Event, Message, MessageAttributes } from '@node-ts/bus-messages'
import { Handler } from '../handler'
import { Transport, TransportMessage } from '../transport'

export type HookAction = 'send' | 'publish' | 'error'

export type BeforeSendCallback = (
  command: Command,
  messageAttributes?: MessageAttributes
) => Promise<void> | void

export type BeforePublishCallback = (
  event: Event,
  messageAttributes?: MessageAttributes
) => Promise<void> | void

export type AfterReceiveCallback<TransportMessageType> = (
  transportMessage: TransportMessageType
) => Promise<void> | void

export type BeforeDispatchCallback = (
  message: Message,
  attributes: MessageAttributes,
  handlers: Handler[]
) => Promise<void> | void

export type AfterDispatchCallback = (
  message: Message,
  attributes: MessageAttributes,
) => Promise<void> | void

export type OnErrorCallback<TransportMessageType> = (
  message: Message,
  error: Error,
  messageAttributes?: MessageAttributes,
  rawMessage?: TransportMessage<TransportMessageType>
) => Promise<void> | void

type HookCallback<TransportMessageType> =
  BeforeSendCallback
  | BeforePublishCallback
  | AfterReceiveCallback<TransportMessageType>
  | BeforeDispatchCallback
  | AfterDispatchCallback
  | OnErrorCallback<TransportMessageType>

/**
 * A repository for all hook events registered with a BusInstance. This persists across scope boundaries
 * so that Bus instances that are scoped to a message handling context still have access to the global set
 * of registered hooks
 *
 * @template TransportMessageType - The raw message type returned from the transport that will be passed to the hooks
 * @example BusHooks<InMemoryMessage>
 * @example BusHooks<SQS.Message>
 */
export class BusHooks<TransportMessageType = any> {
  readonly messageHooks: { [key: string]: HookCallback<TransportMessageType>[] } = {
    beforeSend: [],
    beforePublish: [],
    onError: [],
    afterReceive: [],
    beforeDispatch: [],
    afterDispatch: [],
  }

  get beforeSend (): BeforeSendCallback[] {
    return this.messageHooks.beforeSend as BeforeSendCallback[]
  }

  get beforePublish (): BeforePublishCallback[] {
    return this.messageHooks.publish as BeforePublishCallback[]
  }

  get onError (): OnErrorCallback<TransportMessageType>[] {
    return this.messageHooks.error as OnErrorCallback<TransportMessageType>[]
  }

  get afterReceive (): AfterReceiveCallback<TransportMessageType>[] {
    return this.messageHooks.afterReceive as AfterReceiveCallback<TransportMessageType>[]
  }

  get beforeDispatch (): BeforeDispatchCallback[] {
    return this.messageHooks.beforeDispatch as BeforeDispatchCallback[]
  }

  get afterDispatch (): AfterDispatchCallback[] {
    return this.messageHooks.afterDispatch as AfterDispatchCallback[]
  }
}
