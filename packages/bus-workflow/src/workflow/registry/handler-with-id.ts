export const handlerIdProperty = Symbol('node-ts/workflow/handler-id-property')

export interface HandlerWithId {
  readonly [handlerIdProperty]: string
}

export function isHandlerWithId (handler: object): handler is HandlerWithId {
  return handlerIdProperty in handler
}
