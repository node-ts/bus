import { ContainerModule, interfaces } from 'inversify'
import { BUS_SYMBOLS } from './bus-symbols'
import { MemoryQueue } from './transport'
import { ServiceBus } from './service-bus'
import { JsonSerializer } from './serialization'
import { ApplicationBootstrap } from './application-bootstrap'
import { HandlerRegistry } from './handler'
import { ClassConstructor } from './util'
import { bindLogger } from '@node-ts/logger-core'

export class BusModule extends ContainerModule {

  constructor () {
    super(bind => {
      bindService(bind, BUS_SYMBOLS.Bus, ServiceBus).inSingletonScope()
      bindService(bind, BUS_SYMBOLS.Transport, MemoryQueue).inSingletonScope()
      bindService(bind, BUS_SYMBOLS.Serializer, JsonSerializer)
      bindService(bind, BUS_SYMBOLS.ApplicationBootstrap, ApplicationBootstrap).inSingletonScope()
      bindService(bind, BUS_SYMBOLS.HandlerRegistry, HandlerRegistry).inSingletonScope()
    })
  }
}

function bindService<T> (
  bind: interfaces.Bind,
  symbol: symbol,
  service: ClassConstructor<T>
): interfaces.BindingInWhenOnSyntax<{}> {
  bindLogger(bind, service)
  return bind(symbol).to(service)
}
