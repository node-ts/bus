import { Inject, Injectable, Scope } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { Handler, handlerFor } from '@node-ts/bus-core'
import { BusHandler } from '../bus-handler'
import { BusRequest } from '../bus-request'
import { ChargeCreditCard } from './charge-credit-card'
import { OrderPlaced } from './order-placed'
import { Recorder } from './recorder'

// The tests compile without experimentalDecorators, so decorators are applied by calling them

/**
 * A class handler found by `@BusHandler()`
 */
export class ChargeCreditCardHandler implements Handler<ChargeCreditCard> {
  constructor(private readonly recorder: Recorder) {}

  get messageType() {
    return ChargeCreditCard
  }

  async handle(command: ChargeCreditCard): Promise<void> {
    this.recorder.record({ by: ChargeCreditCardHandler.name, message: command })
  }
}
Injectable()(ChargeCreditCardHandler)
Inject(Recorder)(ChargeCreditCardHandler, undefined, 0)
BusHandler()(ChargeCreditCardHandler)

/**
 * A class handler registered with `BusModule.forFeature()`
 */
export class OrderPlacedHandler implements Handler<OrderPlaced> {
  constructor(private readonly recorder: Recorder) {}

  get messageType() {
    return OrderPlaced
  }

  async handle(event: OrderPlaced): Promise<void> {
    this.recorder.record({ by: OrderPlacedHandler.name, message: event })
  }
}
Injectable()(OrderPlacedHandler)
Inject(Recorder)(OrderPlacedHandler, undefined, 0)

/**
 * A function handler registered with `BusModule.forFeatureAsync()`, which closes over the recorder it's given
 */
export const orderPlacedAuditHandler = (recorder: Recorder) =>
  handlerFor(OrderPlaced, async event =>
    recorder.record({ by: 'orderPlacedAuditHandler', message: event })
  )

/**
 * A request-scoped provider, which gets the message being handled from Nest's `REQUEST`
 */
export class MessageScope {
  constructor(readonly request: BusRequest) {}
}
Injectable({ scope: Scope.REQUEST })(MessageScope)
Inject(REQUEST)(MessageScope, undefined, 0)

/**
 * Two class handlers of the same event that depend on the request-scoped `MessageScope`
 */
export class FirstScopedHandler implements Handler<OrderPlaced> {
  constructor(
    private readonly recorder: Recorder,
    private readonly scope: MessageScope
  ) {}

  get messageType() {
    return OrderPlaced
  }

  async handle(event: OrderPlaced): Promise<void> {
    this.recorder.record({
      by: FirstScopedHandler.name,
      message: event,
      detail: this.scope
    })
  }
}
Injectable()(FirstScopedHandler)
Inject(Recorder)(FirstScopedHandler, undefined, 0)
Inject(MessageScope)(FirstScopedHandler, undefined, 1)
BusHandler()(FirstScopedHandler)

export class SecondScopedHandler implements Handler<OrderPlaced> {
  constructor(
    private readonly recorder: Recorder,
    private readonly scope: MessageScope
  ) {}

  get messageType() {
    return OrderPlaced
  }

  async handle(event: OrderPlaced): Promise<void> {
    this.recorder.record({
      by: SecondScopedHandler.name,
      message: event,
      detail: this.scope
    })
  }
}
Injectable()(SecondScopedHandler)
Inject(Recorder)(SecondScopedHandler, undefined, 0)
Inject(MessageScope)(SecondScopedHandler, undefined, 1)
BusHandler()(SecondScopedHandler)

/**
 * A class handler of a named bus
 */
export class BillingHandler implements Handler<ChargeCreditCard> {
  constructor(private readonly recorder: Recorder) {}

  get messageType() {
    return ChargeCreditCard
  }

  async handle(command: ChargeCreditCard): Promise<void> {
    this.recorder.record({ by: BillingHandler.name, message: command })
  }
}
Injectable()(BillingHandler)
Inject(Recorder)(BillingHandler, undefined, 0)
BusHandler({ bus: 'billing' })(BillingHandler)
