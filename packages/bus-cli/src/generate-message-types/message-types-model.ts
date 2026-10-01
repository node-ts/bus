/**
 * How a field is restored, matching `MessageFieldType` in `@node-ts/bus-messages`
 */
export type FieldModel =
  | 'Date'
  | 'BigInt'
  | { type: string }
  | { array: FieldModel }
  | { set: FieldModel | 'plain' }
  | { map: FieldModel | 'plain'; keys?: 'number' }
  | { record: FieldModel }

/**
 * A class or object type to restore
 */
export interface TypeModel {
  key: string
  /**
   * The class to import, by its export name and the file that declares it. Object types have none.
   */
  class?: { exportName: string; fileName: string }
  fields: [field: string, fieldType: FieldModel][]
}

/**
 * Everything read from the message library, ready to write out
 */
export interface MessageTypesModel {
  /**
   * `$name` → type key, sorted by `$name`
   */
  messages: [name: string, typeKey: string][]
  /**
   * Sorted by key
   */
  types: TypeModel[]
}
