export const BUS_SYMBOLS = {
  Transport: Symbol.for('@node-ts/bus-core/transport'),
  Bus: Symbol.for('@node-ts/bus-core/bus'),
  Serializer: Symbol.for('@node-ts/bus-core/serializer'),
  HandlerRegistry: Symbol.for('@node-ts/bus-core/handler-registry'),
  ApplicationBootstrap: Symbol.for('@node-ts/bus-core/application-bootstrap'),
  JsonSerializer: Symbol.for('@node-ts/bus-core/json-serializer'),
  MessageSerializer: Symbol.for('@node-ts/bus-core/message-serializer'),
  MessageHandlingContext: Symbol.for('@node-ts/bus-core/message-handling-context'),
  BusConfiguration: Symbol.for('@node-ts/bus-core/bus-configuration'),
  TransportConfiguration: Symbol.for('@node-ts/bus-core/transport-configuration')
}

export const BUS_INTERNAL_SYMBOLS = {
  SessionScopeBinder: Symbol.for('@node-ts/bus-core/session-scope-binder'),
  BusHooks: Symbol.for('@node-ts/bus-core/bus-hooks'),
  RawMessage: Symbol.for('@node-ts/bus-core/raw-message'),
  ContainerProvider: Symbol.for('@node-ts/bus-core/container-provider')
}
