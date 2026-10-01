import { DefineMessageOptions } from './define-message-options'
import { DefinedMessage, MessageDefinition } from './message-declaration'

/**
 * Creates the definition that `defineCommand` and `defineEvent` return
 */
export const defineMessage = <TName extends string, TData extends object>(
  name: TName,
  options: DefineMessageOptions | undefined
): MessageDefinition<DefinedMessage<TName, TData>, TData> => {
  const version = options?.version ?? 0
  // An arrow function has no prototype, which is how the bus tells a definition from a message class
  const definition = (data?: TData) => ({
    ...data,
    $name: name,
    $version: version
  })
  return Object.assign(definition, {
    NAME: name
  }) as unknown as MessageDefinition<DefinedMessage<TName, TData>, TData>
}
