import { Inject, Injectable, Scope } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { Handler, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { BusRequest } from '../bus-request'
import { ChargeCreditCard } from './charge-credit-card'
import { FulfilmentState } from './fulfilment-state'
import { Recorder } from './recorder'

// The tests compile without experimentalDecorators, so decorators are applied by calling them

/**
 * An order whose charge fails the first time it's handled, so it's retried
 */
export const DECLINED_ONCE = 'declined-once'

/**
 * A request-scoped provider that builds up state while a message is handled, which must not reach a retry
 */
export class ChargeAttempt {
  readonly charges: string[] = []

  constructor(readonly request: BusRequest) {}
}
Injectable({ scope: Scope.REQUEST })(ChargeAttempt)
Inject(REQUEST)(ChargeAttempt, undefined, 0)

/**
 * A class handler that records a charge in the request-scoped `ChargeAttempt`, and fails the first time it charges
 * `DECLINED_ONCE`
 */
export class ChargeAttemptHandler implements Handler<ChargeCreditCard> {
  constructor(
    private readonly recorder: Recorder,
    private readonly attempt: ChargeAttempt
  ) {}

  get messageType() {
    return ChargeCreditCard
  }

  async handle(command: ChargeCreditCard): Promise<void> {
    this.attempt.charges.push(command.orderId)
    this.recorder.record({
      by: ChargeAttemptHandler.name,
      message: command,
      detail: this.attempt
    })
    const declinedAttempts = this.recorder
      .by(ChargeAttemptHandler.name)
      .filter(({ message }) => message === command)
    if (command.orderId === DECLINED_ONCE && declinedAttempts.length === 1) {
      throw new Error('Card declined')
    }
  }
}
Injectable()(ChargeAttemptHandler)
Inject(Recorder)(ChargeAttemptHandler, undefined, 0)
Inject(ChargeAttempt)(ChargeAttemptHandler, undefined, 1)

/**
 * A class workflow started by the same command, which depends on the request-scoped `ChargeAttempt` too
 */
export class ChargeAttemptWorkflow extends Workflow<FulfilmentState> {
  constructor(
    private readonly recorder: Recorder,
    private readonly attempt: ChargeAttempt
  ) {
    super()
  }

  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentState, ChargeAttemptWorkflow>
  ): void {
    mapper.withState(FulfilmentState).startedBy(ChargeCreditCard, 'start')
  }

  async start(command: ChargeCreditCard): Promise<Partial<FulfilmentState>> {
    this.recorder.record({
      by: ChargeAttemptWorkflow.name,
      message: command,
      detail: this.attempt
    })
    return { orderId: command.orderId }
  }
}
Injectable()(ChargeAttemptWorkflow)
Inject(Recorder)(ChargeAttemptWorkflow, undefined, 0)
Inject(ChargeAttempt)(ChargeAttemptWorkflow, undefined, 1)
