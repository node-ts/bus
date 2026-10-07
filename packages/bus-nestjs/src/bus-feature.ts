import {
  ClassConstructor,
  FunctionWorkflow,
  Handler,
  HandlerDefinition,
  HandlerFor,
  Workflow
} from '@node-ts/bus-core'
import { Message } from '@node-ts/bus-messages'

/**
 * A handler to register with `BusModule.forFeature()`: a class that implements `Handler`, or a handler declared
 * with `handlerFor()`
 */
export type BusFeatureHandler =
  | ClassConstructor<Handler<any, any>>
  | HandlerFor<Message, HandlerDefinition<any, any>>

/**
 * A workflow to register with `BusModule.forFeature()`: a class that extends `Workflow`, or a workflow declared
 * with `defineWorkflow()`
 */
export type BusFeatureWorkflow =
  ClassConstructor<Workflow<any>> | FunctionWorkflow<any>

/**
 * The handlers and workflows a feature module registers with a bus
 */
export interface BusFeature {
  /**
   * Class handlers, which must also be providers, and handlers declared with `handlerFor()`
   */
  handlers?: BusFeatureHandler[]
  /**
   * Class workflows, which must also be providers, and workflows declared with `defineWorkflow()`
   */
  workflows?: BusFeatureWorkflow[]
}
