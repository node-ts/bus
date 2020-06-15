import { ContainerModule, interfaces } from 'inversify'
import { BUS_SYMBOLS, BUS_INTERNAL_SYMBOLS } from './bus-symbols'
import { MessageAttributes } from '@node-ts/bus-messages'
import { MemoryQueue } from './transport'
import { ServiceBus, BusHooks } from './service-bus'
import { JsonSerializer, MessageSerializer } from './serialization'
import { ApplicationBootstrap } from './application-bootstrap'
import { HandlerRegistry } from './handler'
import { ClassConstructor } from './util'
import { bindLogger } from '@node-ts/logger-core'

export type SessionScopeBinder = (bind: interfaces.Bind) => void
export const defaultSessionScopeBinder: SessionScopeBinder = (bind: interfaces.Bind) => {
  bind(BUS_SYMBOLS.Bus).to(ServiceBus).inSingletonScope()
}

export class BusModule extends ContainerModule {

  constructor () {
    super(bind => {
      bind<SessionScopeBinder>(BUS_INTERNAL_SYMBOLS.SessionScopeBinder).toConstantValue(defaultSessionScopeBinder)
      defaultSessionScopeBinder(bind)
      bindLogger(bind, ServiceBus)

      bindService(bind, BUS_SYMBOLS.Transport, MemoryQueue).inSingletonScope()
      bindService(bind, BUS_SYMBOLS.Serializer, JsonSerializer)
      bindService(bind, BUS_SYMBOLS.ApplicationBootstrap, ApplicationBootstrap).inSingletonScope()
      bindService(bind, BUS_SYMBOLS.HandlerRegistry, HandlerRegistry).inSingletonScope()
      bindService(bind, BUS_SYMBOLS.JsonSerializer, JsonSerializer)
      bindService(bind, BUS_SYMBOLS.MessageSerializer, MessageSerializer)
      bindService(bind, BUS_INTERNAL_SYMBOLS.BusHooks, BusHooks).inSingletonScope()

      bind(BUS_SYMBOLS.MessageHandlingContext).toConstantValue(new MessageAttributes())
    })
  }
}

function bindService<T> (
  bind: interfaces.Bind,
  symbol: symbol,
  service: ClassConstructor<T>
): interfaces.BindingInWhenOnSyntax<unknown> {
  bindLogger(bind, service)
  return bind(symbol).to(service)
}
